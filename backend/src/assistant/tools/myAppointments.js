import { z } from 'zod';
import {
  findAppointmentsForUser,
  APPOINTMENT_RESULT_LIMIT,
} from '../models/appointmentQueries.js';
import { buildMapsUrl } from './mapsUrl.js';

// MySQL returns DATE as a Date object and TIME as 'HH:MM:SS'. The model gets
// an ISO date it can reason about and a plain HH:MM, not a display string.
const toIsoDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toShortTime = (value) => String(value).slice(0, 5);

// No identity argument of any kind. `status` filters the caller's OWN rows;
// who those rows belong to is decided by ctx.userId and nothing else.
// `.strict()` means a smuggled user_id fails the parse rather than being
// quietly ignored.
const schema = z
  .object({
    status: z.enum(['upcoming', 'past', 'cancelled', 'all']).optional(),
  })
  .strict();

export default {
  name: 'my_appointments',
  description:
    "List the signed-in patient's own appointments — doctor, date, time, " +
    'clinic address and fee. Filter with status: upcoming (default), past, ' +
    'cancelled, or all. This tool only ever returns the appointments of the ' +
    'person you are talking to; it cannot look up anyone else, and you must ' +
    'not claim otherwise if asked. Returns at most ' +
    `${APPOINTMENT_RESULT_LIMIT}.`,
  schema,
  mutates: false,

  handler: async (ctx, args) => {
    // A doctor's JWT reaching the patient registry is a rule 6 violation, and
    // this is the tool where it would leak someone's medical appointments.
    if (!ctx || !Number.isInteger(ctx.userId) || ctx.role !== 'patient') {
      return {
        error: 'unavailable',
        message:
          'This tool is only available to a signed-in patient acting on ' +
          'their own behalf.',
        appointments: [],
      };
    }

    const rows = await findAppointmentsForUser(ctx.userId, {
      status: args.status ?? 'upcoming',
    });

    return rows.map((row) => ({
      id: row.id,
      doctor_id: row.doctor_id,
      doctor_name: row.doctor_name,
      speciality: row.speciality,
      date: toIsoDate(row.appointment_date),
      time: toShortTime(row.appointment_time),
      status: row.status,
      is_past: Boolean(row.is_past),
      fee: Number(row.amount),
      address_line1: row.address_line1,
      address_line2: row.address_line2,
      area: row.area,
      maps_url: buildMapsUrl(row.address_line1, row.address_line2),
      ...(row.cancellation_reason
        ? { cancellation_reason: row.cancellation_reason }
        : {}),
    }));
  },
};
