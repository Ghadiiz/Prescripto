import { z } from 'zod';
import { listSpecialities } from '../models/specialityQueries.js';

// No arguments at all. `.strict()` still matters: a model that invents one
// gets a parse failure rather than having it silently ignored.
const schema = z.object({}).strict();

export default {
  name: 'list_specialities',
  description:
    'List every medical speciality this clinic offers, with its id and name. ' +
    'Use these exact names when filtering a doctor search by speciality. ' +
    'Takes no arguments.',
  schema,
  mutates: false,

  // ctx is unused: the speciality list is the same for everyone.
  handler: async () => listSpecialities(),
};
