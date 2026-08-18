import { z } from 'zod';
import * as appointmentService from '../../appointments/services/appointmentService.js';
import { getDoctorById } from '../models/doctorQueries.js';
import { sanitizeAdminText } from '../guardrails/sanitize.js';

const MAX_DAYS = 7;

// Local-date helpers. Slots are generated against the server's clock in
// appointmentService, so date comparisons here use local time too — using UTC
// would disagree with the service by up to a day near midnight.
const toDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (dateString, offset) => {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + offset);
  return date;
};

const isBeforeToday = (dateString) => {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
};

// `doctor_id` names another party, not the caller — not an identity key.
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
    'Check how many appointment slots a doctor has free on a date, or across ' +
    `up to ${MAX_DAYS} consecutive days starting from it. Returns a free-slot ` +
    'count per date and a checked_at timestamp. This is a snapshot of what ' +
    'was free at that moment, not a reservation: nothing is held, and slots ' +
    'can be taken by someone else before the patient books. Never tell a ' +
    'patient a time is being kept for them.',
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
        });
      } catch {
        dates.push({
          date: currentDate,
          available: false,
          free_slot_count: 0,
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
