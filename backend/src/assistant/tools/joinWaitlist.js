import { z } from 'zod';

import { getDoctorById } from '../models/doctorQueries.js';
import { insertWaitlistEntry } from '../models/waitlistQueries.js';
import { findAppointmentWithDoctorOnDate } from '../models/appointmentQueries.js';
import { sanitizeAdminText } from '../guardrails/sanitize.js';
import { issueConfirmation, spendConfirmation } from '../confirmations.js';
import { isBeforeToday, daysBetween, toDateString } from './dates.js';
import {
  getAvailableSlots,
  convertTo12Hour,
} from '../../appointments/services/appointmentService.js';
import { findAppointmentsByDoctorAndDate } from '../../appointments/models/appointmentModel.js';

// THE ONLY WRITE TOOL. Rule 2 allows exactly this one exception, and nothing
// else in the registry may follow it without changing that rule.
//
// Two things carry the weight here:
//
//   Identity. `user_id` comes from ctx and there is no argument that could
//   supply it — the same rule 3 discipline as every read tool, except a
//   mistake now creates a row under someone else's name rather than showing
//   them the wrong list.
//
//   Confirmation. The first call writes NOTHING. It returns a summary and a
//   single-use token bound to this patient, this session and these exact
//   arguments; only a second call carrying that token writes. See
//   confirmations.js for what that does and does not guarantee.

const MAX_WINDOW_DAYS = 30;

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

const TIME = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM on a 24-hour clock');

// `.strict()`: an unknown key fails the parse, so a smuggled user_id is
// rejected before the handler runs rather than being quietly ignored.
const schema = z
  .object({
    doctor_id: z.number().int().positive(),
    date_from: DATE,
    date_to: DATE,
    // 7.5 made these REQUIRED, and that is load-bearing rather than tidy: the
    // model cannot call this tool without a specific slot, so a vague request
    // ("waitlist me next week") HAS to be narrowed with check_availability
    // first. Single-slot stops being something the assistant remembers to do
    // and becomes something it cannot avoid.
    //
    // The four fields survive from 7.4, where they were a range. See the
    // single-slot guard in the handler and the dormancy note in
    // models/waitlistQueries.js.
    time_from: TIME,
    time_to: TIME,
    // Absent on the first call. Present only on the second, and only if the
    // first one issued it.
    confirmation_token: z.string().min(1).optional(),
  })
  .strict();

// The TIME columns want seconds; the model gives 'HH:MM'.
const toSqlTime = (value) => (value ? `${value}:00` : null);

const refuse = (reason, message) => ({ status: 'refused', reason, message });

export default {
  name: 'join_waitlist',
  description:
    'Ask to be told if a doctor frees up a slot between two dates. This is ' +
    'the one thing that changes anything: it adds the signed-in patient to a ' +
    "doctor's waitlist. It does NOT book an appointment and does not hold a " +
    'slot. Call it first WITHOUT confirmation_token to get a summary of what ' +
    'would be recorded — nothing is written by that call. Show the patient ' +
    'that summary, ask them to confirm in their own words, and only then call ' +
    'again with the confirmation_token you were given.\n\n' +
    'A waitlist entry is ONE SPECIFIC SLOT: one day and one start time. Pass ' +
    'the same date in date_from and date_to, and the same time in time_from ' +
    'and time_to (HH:MM on a 24-hour clock). A range is refused.\n\n' +
    'So if the patient is vague — "sometime next week", "any morning" — do ' +
    'NOT guess. Call check_availability for the days they mean, show them ' +
    'which slots are free, and ask which one they want. Only call this tool ' +
    'once you have a single day and time. They can waitlist several slots by ' +
    'asking again for each.\n\n' +
    'The slot must be one a patient could actually book: a real half-hour ' +
    'start, not in the past, within ' +
    `${MAX_WINDOW_DAYS} days, and currently TAKEN. Waitlisting a slot that ` +
    'is already free is refused — tell them to book it instead.',
  schema,
  mutates: true,

  handler: async (ctx, args, { sessionId } = {}) => {
    const {
      doctor_id: doctorId,
      date_from: dateFrom,
      date_to: dateTo,
      time_from: timeFrom,
      time_to: timeTo,
    } = args;

    // The guard my_appointments has, on the one tool that WRITES.
    //
    // 5.5 introduced doctor contexts, which are `{ doctorId, role }` — so a
    // doctor ctx arriving here already fails on `ctx.userId` being undefined
    // against a NOT NULL column. This makes that explicit rather than
    // incidental: the row this tool writes says which patient is waiting, and
    // "whoever this is" is not an acceptable answer to that question.
    if (!ctx || !Number.isInteger(ctx.userId) || ctx.role !== 'patient') {
      return refuse(
        'unavailable',
        'This tool is only available to a signed-in patient acting on their ' +
          'own behalf.',
      );
    }

    // --- validation, before anything is offered for confirmation ----------

    // --- 7.5: a waitlist entry is ONE SLOT -------------------------------
    //
    // The columns behind these are still a range — 7.4's schema is kept and
    // dormant on purpose (see waitlistQueries.js). Which is exactly why the
    // narrowing cannot live in the assistant's judgement: the database would
    // happily accept a 30-day window, so the REFUSAL here is what makes
    // single-slot a guarantee rather than a habit.
    if (dateFrom !== dateTo) {
      return refuse(
        'not_a_single_slot',
        'A waitlist entry covers one specific day. Ask the patient which day ' +
          'they want and pass it as both date_from and date_to. They can ' +
          'waitlist more than one day by asking again for each.',
      );
    }

    if (timeFrom !== timeTo) {
      return refuse(
        'not_a_single_slot',
        'A waitlist entry covers one specific start time. Show the patient ' +
          'which slots are free with check_availability, ask which one they ' +
          'want, and pass it as both time_from and time_to.',
      );
    }

    if (isBeforeToday(dateFrom)) {
      return refuse(
        'date_in_past',
        'That date has already passed. Give a date from today onwards.',
      );
    }

    // MAX_WINDOW_DAYS measured a SPAN until 7.5, which is now always zero. It
    // measures reach instead — how far ahead a slot may be — which keeps it
    // load-bearing and keeps it equal to the booking page's BOOKABLE_DAYS.
    // A slot the page cannot show is a slot the patient cannot act on.
    if (daysBetween(toDateString(new Date()), dateFrom) >= MAX_WINDOW_DAYS) {
      return refuse(
        'date_too_far',
        `Waitlist slots reach ${MAX_WINDOW_DAYS} days ahead, which is as far ` +
          'as the booking page goes. Ask them nearer the date.',
      );
    }

    const doctor = await getDoctorById(doctorId);

    if (!doctor) {
      return refuse('doctor_not_found', 'No doctor has that id.');
    }

    if (!doctor.available) {
      return refuse(
        'doctor_not_accepting',
        'That doctor is not accepting appointments at all, so a waitlist ' +
          'would not help.',
      );
    }

    // --- 7.5: is this slot real, and is it actually taken? ----------------
    //
    // Three outcomes, not two. A time that is neither free nor booked is not a
    // slot at all — 10:17, or 03:00, or a slot that has already passed today.
    // Waitlisting one writes a row nothing can ever match, and the patient
    // waits forever for something that cannot happen.
    //
    // Both lists come from the functions that already define "free" and
    // "taken" for the booking page and for 7.3, so there is no second opinion
    // about either.
    const checkedAt = new Date().toISOString();
    const slotLabel = convertTo12Hour(`${timeFrom}:00`);

    let freeSlots;
    let bookedTimes;

    try {
      freeSlots = await getAvailableSlots(doctorId, dateFrom);
      bookedTimes = await findAppointmentsByDoctorAndDate(doctorId, dateFrom);
    } catch {
      // Fails CLOSED, unlike the read tools that answer `unavailable` and move
      // on. This one WRITES, and the whole purpose of the lookup is to decide
      // whether the write makes sense — so an unverifiable answer must mean
      // no. A tool must also never throw an HTTP-shaped error at the model.
      return refuse(
        'availability_unavailable',
        'Could not check whether that slot is free right now, so nothing was ' +
          'recorded. Try again shortly.',
      );
    }

    const isFree = freeSlots.includes(slotLabel);
    const isTaken = bookedTimes.some(
      (time) => String(time).slice(0, 5) === timeFrom,
    );

    // --- 7.5: does this patient already hold that doctor, that day? -------
    //
    // Scoped to THIS doctor and THIS day, and nothing else. See the query.
    const sameDay = await findAppointmentWithDoctorOnDate(
      ctx.userId,
      doctorId,
      dateFrom,
    );
    const conflict = sameDay[0] ?? null;
    const conflictTime = conflict
      ? convertTo12Hour(String(conflict.appointment_time))
      : null;

    // The doctor's name is the ONLY doctor named in any of these messages,
    // and it is the doctor the patient asked about. Nothing here can surface
    // an appointment with anyone else — the query cannot see one.
    const doctorName = sanitizeAdminText({ name: doctor.name }).name;

    if (!isFree && !isTaken) {
      return refuse(
        'not_a_bookable_slot',
        `${slotLabel} is not a slot ${doctorName} can be booked for on that ` +
          'day — it may not be a real half-hour start, or it may already ' +
          'have passed. Use check_availability to see the real slots.',
      );
    }

    if (isFree) {
      return {
        status: 'refused',
        reason: 'slot_already_free',
        checked_at: checkedAt,
        message: conflict
          ? `${slotLabel} was free just now, so there is nothing to wait ` +
            `for — but they already have an appointment with ${doctorName} ` +
            `at ${conflictTime} that day, and the app allows one at a time ` +
            'with a doctor. To take this slot they would cancel that one in ' +
            'the app first. Nothing is held until they book.'
          : `${slotLabel} was free just now, so there is nothing to wait ` +
            'for — they can book it on the doctor\'s page. Nothing is held ' +
            'until they do.',
      };
    }

    if (conflict) {
      return refuse(
        'already_booked_that_day',
        `They already have an appointment with ${doctorName} at ` +
          `${conflictTime} that day. One at a time with a doctor: to wait ` +
          `for ${slotLabel} instead, they cancel the existing one in the app ` +
          'first, then ask again. This tool cannot cancel anything.',
      );
    }

    const summary = {
      doctor_id: doctorId,
      // Admin-controlled free text, sanitised like every other tool result.
      doctor_name: doctorName,
      date_from: dateFrom,
      date_to: dateTo,
      // Present so the patient confirms the TIME as well as the day. The
      // confirmation token is bound to every argument (7.4), so agreeing to
      // one slot cannot write another.
      time_from: timeFrom,
      time_to: timeTo,
      // Rule 7 reaches the preview. "This slot is taken, which is why a
      // waitlist makes sense" is an availability claim like any other, and it
      // must not read as settled: someone can cancel a second from now.
      slot_status: 'taken',
      checked_at: checkedAt,
    };

    // --- phase one: nothing is written -------------------------------------

    if (!args.confirmation_token) {
      return {
        status: 'confirmation_required',
        confirmation_token: await issueConfirmation(ctx, sessionId, args),
        summary,
        message:
          'Nothing has been recorded yet. Show the patient these details, ask ' +
          'them to confirm, and call again with the confirmation_token.',
      };
    }

    // --- phase two: the write ----------------------------------------------

    if (!(await spendConfirmation(args.confirmation_token, ctx, sessionId, args))) {
      // Covers every failure the same way: unknown, expired, already spent,
      // issued to another patient or session, or issued for different dates.
      return refuse(
        'confirmation_invalid',
        'That confirmation is no longer valid — it may have expired, already ' +
          'been used, or been issued for different details. Start again ' +
          'without a confirmation_token and ask the patient to confirm.',
      );
    }

    try {
      const waitlistId = await insertWaitlistEntry(
        // ctx, never args. This is the line rule 3 exists for.
        ctx.userId,
        doctorId,
        dateFrom,
        dateTo,
        toSqlTime(timeFrom),
        toSqlTime(timeTo),
      );

      return { status: 'joined', waitlist_id: waitlistId, ...summary };
    } catch (error) {
      // The unique index did its job: this patient already has an active
      // request for exactly this doctor and window. Not an error to report as
      // a failure — the desired state already holds.
      if (error.code === 'ER_DUP_ENTRY') {
        return {
          status: 'already_waiting',
          ...summary,
          message: timeFrom
            ? 'They are already on this waitlist for those dates and hours.'
            : 'They are already on this waitlist for those dates.',
        };
      }

      throw error;
    }
  },
};
