import { z } from 'zod';
import {
  searchDoctors,
  SEARCH_RESULT_LIMIT,
} from '../models/doctorQueries.js';
import {
  DOCTOR_LANGUAGES,
  DOCTOR_AREAS,
  DOCTOR_GENDERS,
} from '../../constants/doctorOptions.js';

// Built server-side, never by the model: a URL the model composed could point
// anywhere. Returns null when a doctor has no address on file.
const buildMapsUrl = (addressLine1, addressLine2) => {
  const address = [addressLine1, addressLine2].filter(Boolean).join(', ');
  if (!address) return null;

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
};

// `.strict()` matters for rule 3: an unknown key — say a hallucinated
// `user_id` — fails the parse loudly instead of riding along unnoticed in
// `args`. Identity comes from `ctx` and only from `ctx`.
const schema = z
  .object({
    speciality: z.string().optional(),
    min_experience_years: z.number().int().min(0).max(60).optional(),
    max_fees: z.number().positive().optional(),
    // Closed vocabularies from the same constants the admin validators use.
    language: z.enum(DOCTOR_LANGUAGES).optional(),
    gender: z.enum(DOCTOR_GENDERS).optional(),
    area: z.enum(DOCTOR_AREAS).optional(),
  })
  .strict();

export default {
  name: 'search_doctors',
  description:
    'Find doctors currently accepting appointments, optionally filtered by ' +
    'speciality, minimum years of experience, maximum consultation fee, ' +
    'spoken language, gender, or area of Amman. Returns at most ' +
    `${SEARCH_RESULT_LIMIT} doctors, most experienced first. Results are ` +
    'directory data, not a recommendation, and do not indicate whether any ' +
    'particular time is free — use check_availability for that.',
  schema,
  mutates: false,

  // ctx is unused: searching the directory is not scoped to a user. It stays
  // in the signature because every tool has the same shape and the audit log
  // records ctx.userId for each call.
  handler: async (ctx, args) => {
    const doctors = await searchDoctors(args);

    return doctors.map((doctor) => ({
      ...doctor,
      fees: Number(doctor.fees),
      maps_url: buildMapsUrl(doctor.address_line1, doctor.address_line2),
    }));
  },
};
