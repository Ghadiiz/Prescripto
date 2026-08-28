import { z } from 'zod';
import {
  findAppointmentsForDoctorRange,
  SCHEDULE_RESULT_LIMIT,
} from '../models/doctorScheduleQueries.js';
import { sanitizeAdminText } from '../guardrails/sanitize.js';
import { toDateString, addDays } from '../tools/dates.js';
import { requireDoctor } from './requireDoctor.js';

const MAX_DAYS = 7;

// No doctor_id. On this side of the assistant a doctor id names the CALLER,
// which makes it an identity key — the mirror of the patient tools, where
// doctor_id names another party and is allowed. The guardrail suite asserts
// that asymmetry.
const schema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
      .optional(),
    days: z.number().int().min(1).max(MAX_DAYS).optional(),
    include_cancelled: z.boolean().optional(),
  })
  .strict();

const toShortTime = (value) => String(value).slice(0, 5);

const toIsoDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return toDateString(date);
};

export default {
  name: 'my_schedule',
  description:
    "List the signed-in doctor's own booked appointments for a date, or " +
    `across up to ${MAX_DAYS} consecutive days from it. Defaults to today. ` +
    'Returns the time, patient name and status of each appointment. ' +
    'Cancelled appointments are left out unless include_cancelled is true. ' +
    'This tool only ever returns the schedule of the doctor you are talking ' +
    'to; it cannot look up another doctor, and you must not claim otherwise ' +
    `if asked. Returns at most ${SCHEDULE_RESULT_LIMIT} appointments.`,
  schema,
  mutates: false,

  handler: async (ctx, args) => {
    const denied = requireDoctor(ctx);
    if (denied) return { ...denied, dates: [] };

    const days = args.days ?? 1;
    const from = args.date ?? toDateString(new Date());
    const to = toDateString(addDays(from, days - 1));

    const rows = await findAppointmentsForDoctorRange(ctx.doctorId, from, to, {
      includeCancelled: args.include_cancelled ?? false,
    });

    // Grouped per date so a week's answer keeps its shape, and so a day with
    // nothing booked is reported as empty rather than being missing — "you
    // have nothing on Thursday" is an answer, and a gap in a list is not.
    const byDate = new Map();
    for (let offset = 0; offset < days; offset += 1) {
      byDate.set(toDateString(addDays(from, offset)), []);
    }

    for (const row of rows) {
      const date = toIsoDate(row.appointment_date);
      if (!byDate.has(date)) byDate.set(date, []);

      byDate.get(date).push(
        // patient_name is written by the patient, not by us. sanitizeAdminText
        // strips it and lists it under _unverified for the same reason it does
        // for doctors.about: free text reaching a prompt is data, never
        // instructions.
        sanitizeAdminText({
          id: row.id,
          time: toShortTime(row.appointment_time),
          patient_name: row.patient_name,
          status: row.status,
          is_past: Boolean(row.is_past),
          fee: Number(row.amount),
          ...(row.cancellation_reason
            ? { cancellation_reason: row.cancellation_reason }
            : {}),
        }),
      );
    }

    return {
      checked_at: new Date().toISOString(),
      dates: [...byDate.entries()].map(([date, appointments]) => ({
        date,
        appointment_count: appointments.length,
        appointments,
      })),
    };
  },
};
