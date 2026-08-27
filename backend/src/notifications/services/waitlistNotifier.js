import {
  findActiveWaitlistForSlot,
  findUsersWithUnreadSlotNotice,
} from '../models/waitlistMatchModel.js';
import { insertNotification } from '../models/notificationModel.js';
import { getDoctorById } from '../../assistant/models/doctorQueries.js';
import { sanitizeAdminText } from '../../assistant/guardrails/sanitize.js';
import { NOTIFICATION_TYPE } from '../../constants/notificationTypes.js';
import { isBeforeToday } from '../../assistant/tools/dates.js';

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

export const notifyWaitlistForFreedSlot = async ({
  doctorId,
  date,
  excludeUserId = null,
}) => {
  const freedDate = toDateString(date);

  // Cancelling last week's appointment frees nothing anyone can book.
  if (isBeforeToday(freedDate)) return { notified: 0, reason: 'date_in_past' };

  const waiting = await findActiveWaitlistForSlot(doctorId, freedDate);

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
// outcome by far.
//
// The cost, stated rather than hidden: that notification is LOST, with this
// console line as its only trace. Acceptable because the waitlist row
// survives, so the next cancellation in the patient's window still reaches
// them. 6.2's job queue is where this becomes durable.
export const notifyWaitlistSafely = async (args) => {
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
