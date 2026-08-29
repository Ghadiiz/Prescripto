import { z } from 'zod';
import * as appointmentService from '../../appointments/services/appointmentService.js';
import { getDoctorById } from '../models/doctorQueries.js';
import { sanitizeAdminText } from '../guardrails/sanitize.js';
import { toDateString, addDays, isBeforeToday } from './dates.js';

const MAX_DAYS = 7;

const schema = z
  .object({
    doctor_id: z.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    days: z.number().int().min(1).max(MAX_DAYS).optional(),
  })
  .strict();

export default {
  name: 'check_availability',
  description:
    'Check which appointment slots a doctor has free on a date, or across ' +
    `up to ${MAX_DAYS} consecutive days starting from it. Returns the free ` +
    'start times per date, a free-slot count, and a checked_at timestamp, so ' +
    'you can answer questions about particular hours rather than only how ' +
    'many slots there are. This is a snapshot of what was free at that ' +
    'moment, not a reservation: nothing is held, and any of these times can ' +
    'be taken by someone else before the patient books. Naming a time makes ' +
    'that easier to forget, so never tell a patient a time is being kept for ' +
    'them.',
  schema,
  mutates: false,

  // ctx is unused: availability is the same for every patient.
  handler: async (ctx, args) => {
    const { doctor_id: doctorId, date, days = 1 } = args;

    // Resolved once, so an unknown or not-accepting doctor is answered
    // without calling the slot service per date.
    const doctor = await getDoctorById(doctorId);
    if (!doctor) return null;

    // Taken before the loop so every date in one response shares it.
    const checkedAt = new Date().toISOString();

    if (!doctor.available) {
      return sanitizeAdminText({
        doctor_id: doctorId,
        doctor_name: doctor.name,
        accepting_appointments: false,
        checked_at: checkedAt,
        dates: [],
      });
    }

    const dates = [];

    for (let offset = 0; offset < days; offset += 1) {
      const currentDate = toDateString(addDays(date, offset));

      // The guard appointmentService lacks: for a past date it would generate
      // the full 10:00-21:00 grid and report the day as wide open.
      if (isBeforeToday(currentDate)) {
        dates.push({
          date: currentDate,
          available: false,
          free_slot_count: 0,
          // Always present, on every branch, so the model never has to reason
          // about a missing field to decide whether a time is free.
          free_times: [],
          reason: 'date_in_past',
        });
        continue;
      }

      // Pre-checked above, but a tool must never throw an HTTP-shaped error
      // at the model.
      try {
        const slots = await appointmentService.getAvailableSlots(
          doctorId,
          currentDate,
        );

        dates.push({
          date: currentDate,
          available: slots.length > 0,
          free_slot_count: slots.length,
          // The list `getAvailableSlots` already built and this tool used to
          // discard. Booked times are absent because the service removes them;
          // the query behind it selects `appointment_time` alone, so WHO holds
          // a slot is never read (rule 4). "10:30 is taken" is availability;
          // "10:30 is taken by Sara" would be someone's medical appointment.
          free_times: slots,
        });
      } catch {
        dates.push({
          date: currentDate,
          available: false,
          free_slot_count: 0,
          free_times: [],
          reason: 'unavailable',
        });
      }
    }

    return sanitizeAdminText({
      doctor_id: doctorId,
      doctor_name: doctor.name,
      accepting_appointments: true,
      checked_at: checkedAt,
      dates,
    });
  },
};
