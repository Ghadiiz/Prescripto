import { z } from 'zod';

import { getDoctorById } from '../models/doctorQueries.js';
import { insertWaitlistEntry } from '../models/waitlistQueries.js';
import { sanitizeAdminText } from '../guardrails/sanitize.js';
import { issueConfirmation, spendConfirmation } from '../confirmations.js';
import { isBeforeToday, daysBetween } from './dates.js';

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

// `.strict()`: an unknown key fails the parse, so a smuggled user_id is
// rejected before the handler runs rather than being quietly ignored.
const schema = z
  .object({
    doctor_id: z.number().int().positive(),
    date_from: DATE,
    date_to: DATE,
    // Absent on the first call. Present only on the second, and only if the
    // first one issued it.
    confirmation_token: z.string().min(1).optional(),
  })
  .strict();

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
    'again with the confirmation_token you were given. Dates are YYYY-MM-DD, ' +
    `must not be in the past, and may span at most ${MAX_WINDOW_DAYS} days.`,
  schema,
  mutates: true,

  handler: async (ctx, args, { sessionId } = {}) => {
    const { doctor_id: doctorId, date_from: dateFrom, date_to: dateTo } = args;

    // --- validation, before anything is offered for confirmation ----------

    if (isBeforeToday(dateFrom)) {
      return refuse(
        'date_in_past',
        'That start date has already passed. Give a date from today onwards.',
      );
    }

    const span = daysBetween(dateFrom, dateTo);

    if (span < 0) {
      return refuse('range_reversed', 'The end date falls before the start date.');
    }

    if (span + 1 > MAX_WINDOW_DAYS) {
      return refuse(
        'range_too_long',
        `A waitlist window can cover at most ${MAX_WINDOW_DAYS} days.`,
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

    const summary = {
      doctor_id: doctorId,
      // Admin-controlled free text, sanitised like every other tool result.
      doctor_name: sanitizeAdminText({ name: doctor.name }).name,
      date_from: dateFrom,
      date_to: dateTo,
    };

    // --- phase one: nothing is written -------------------------------------

    if (!args.confirmation_token) {
      return {
        status: 'confirmation_required',
        confirmation_token: issueConfirmation(ctx, sessionId, args),
        summary,
        message:
          'Nothing has been recorded yet. Show the patient these details, ask ' +
          'them to confirm, and call again with the confirmation_token.',
      };
    }

    // --- phase two: the write ----------------------------------------------

    if (!spendConfirmation(args.confirmation_token, ctx, sessionId, args)) {
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
          message: 'They are already on this waitlist for those dates.',
        };
      }

      throw error;
    }
  },
};
