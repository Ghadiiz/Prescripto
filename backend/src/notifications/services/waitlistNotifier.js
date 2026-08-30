import {
  findActiveWaitlistForSlot,
  findUsersWithUnreadSlotNotice,
} from '../models/waitlistMatchModel.js';
import { insertNotification } from '../models/notificationModel.js';
import { getDoctorById } from '../../assistant/models/doctorQueries.js';
import { sanitizeAdminText } from '../../assistant/guardrails/sanitize.js';
import { NOTIFICATION_TYPE } from '../../constants/notificationTypes.js';
import { isBeforeToday } from '../../assistant/tools/dates.js';
import { enqueueWaitlistNotification } from '../../queue/waitlistQueue.js';
import {
  convertTo12Hour,
  convertTo24Hour,
} from '../../appointments/services/appointmentService.js';

// Turns a freed slot into notifications.
//
// Called after a cancellation has ALREADY COMMITTED, from both cancel paths —
// the patient's and the doctor's, which share no model function.

// The date arrives as whatever MySQL handed the caller: a Date for a DATE
// column, or a string. Both cancel services read the row before updating it,
// so this normalises rather than assuming.
const toDateString = (value) => {
  if (typeof value === 'string') return value.slice(0, 10);

  const date = value instanceof Date ? value : new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// The freed time as the booking grid writes it — '10:30 AM'. Deliberately the
// SAME function `getAvailableSlots` uses, so the string in a notification and
// the strings on the booking page cannot disagree; 7.2's click-through matches
// one against the other.
//
// Returns null rather than throwing when there is no time. That is not
// defensive padding: notifications written before 7.2 have none, and a job
// enqueued by the previous deploy can reach this worker without one.
// IDEMPOTENT, and it has to be. The queued path normalises once when building
// the job payload and the worker hands the result back through here, so a
// value that is already a label must pass straight through — converting
// '10:30 AM' again yields '10:30 AM AM'. That also covers the deploy straddle,
// where an old job carries a raw '10:30:00' and a new one carries a label.
const SLOT_LABEL = /^\d{2}:\d{2} (AM|PM)$/;

const toSlotTime = (value) => {
  if (!value) return null;

  const raw = String(value).trim();
  if (SLOT_LABEL.test(raw)) return raw;

  return /^\d{1,2}:\d{2}/.test(raw) ? convertTo12Hour(raw) : null;
};

export const notifyWaitlistForFreedSlot = async ({
  doctorId,
  date,
  time = null,
  excludeUserId = null,
}) => {
  const freedDate = toDateString(date);
  const freedTime = toSlotTime(time);
  // 7.4 matches against TIME columns, so the label goes back to 24-hour form.
  // Null when the job carried no time — the matcher then falls back to
  // matching every waiting row, as it did before 7.2.
  const freedTime24 = freedTime ? convertTo24Hour(freedTime) : null;

  // Cancelling last week's appointment frees nothing anyone can book.
  if (isBeforeToday(freedDate)) return { notified: 0, reason: 'date_in_past' };

  const waiting = await findActiveWaitlistForSlot(
    doctorId,
    freedDate,
    freedTime24,
  );

  // One notification per PATIENT, not per waitlist row. A patient may hold two
  // overlapping windows — Sep 1-7 and Sep 5-10 both cover Sep 6 — because
  // 006's unique key is on the exact tuple, not on overlap. Grouping here is
  // exact and races with nothing, since it happens inside one call.
  const candidates = [
    ...new Set(
      waiting
        .map((row) => row.user_id)
        // The patient who cancelled freed this slot on purpose.
        .filter((userId) => userId !== excludeUserId),
    ),
  ];

  if (candidates.length === 0) return { notified: 0, reason: 'nobody_waiting' };

  const alreadyTold = await findUsersWithUnreadSlotNotice(
    candidates,
    doctorId,
    freedDate,
  );
  const recipients = candidates.filter((userId) => !alreadyTold.has(userId));

  if (recipients.length === 0) return { notified: 0, reason: 'already_unread' };

  const doctor = await getDoctorById(doctorId);

  const payload = {
    doctor_id: doctorId,
    // Admin-controlled free text reaching a patient's screen, so it goes
    // through the same sanitiser every tool result does.
    doctor_name: sanitizeAdminText({ name: doctor?.name ?? 'A doctor' }).name,
    date: freedDate,
    // 7.2. Omitted rather than null when unknown, so an old-shaped payload and
    // a new one with no time read the same to the bell.
    ...(freedTime ? { slot_time: freedTime } : {}),
  };

  for (const userId of recipients) {
    await insertNotification(userId, NOTIFICATION_TYPE.WAITLIST_SLOT_OPEN, payload);
  }

  return { notified: recipients.length, reason: 'sent' };
};

// What the cancel paths call.
//
// The appointment is already cancelled by the time this runs. Letting a
// notification failure propagate would report failure for something that
// succeeded, and invite the patient to cancel again — the more damaging
// outcome by far. That guarantee is unchanged by 6.2 and is why the whole
// body below sits inside error handling.
//
// 6.2 made it a LADDER. 5.4's stated cost was that a failed notification was
// simply lost; each rung here is a cheaper failure than the one under it:
//
//   1. enqueue        — durable. BullMQ retries it if the write fails.
//   2. notify inline  — 5.4's behaviour. Used when there is no Redis at all,
//                       and when the enqueue itself failed.
//   3. log and give up — 5.4's last resort, unchanged.
//
// Note this falls BACK where confirmations.js fails CLOSED, and the difference
// is deliberate: that one guards a write a patient authorised, so uncertainty
// must mean no. Here the alternative to trying is losing a notification, which
// is the exact thing this increment exists to stop.
export const notifyWaitlistSafely = async (args) => {
  // Normalised once, here, so the job payload carries a plain 'YYYY-MM-DD'
  // rather than whatever MySQL handed the caller. A Date would survive
  // JSON round-tripping as an ISO timestamp and arrive at the worker as a
  // different shape from the one the inline path sees.
  const payload = {
    doctorId: args?.doctorId,
    date: toDateString(args?.date),
    // Normalised here for the same reason the date is: a raw TIME value from
    // MySQL would not survive JSON round-tripping identically, so the queued
    // path would see a different shape from the inline one.
    time: toSlotTime(args?.time),
    excludeUserId: args?.excludeUserId ?? null,
  };

  try {
    const job = await enqueueWaitlistNotification(payload);

    // A job means it is durable now; the worker owns it from here.
    if (job) return { queued: true, job_id: job.id, reason: 'queued' };

    // null means Redis is not configured — the DISABLED state, which is
    // normal operation, not a fault. Fall through to inline without a log
    // line; there is nothing wrong to report.
  } catch (error) {
    // Configured but not working. Worth a line, because the durability this
    // increment adds is silently absent until someone fixes it.
    console.error(
      `Could not queue the waitlist notification for doctor ` +
        `${payload.doctorId} on ${payload.date} (${error.message}). ` +
        'Falling back to notifying inline — this one is not retryable.',
    );
  }

  try {
    return await notifyWaitlistForFreedSlot(args);
  } catch (error) {
    console.error(
      `Waitlist notification failed for doctor ${args?.doctorId} on ` +
        `${args?.date}: ${error.message}. The cancellation itself succeeded.`,
    );
    return { notified: 0, reason: 'failed' };
  }
};
