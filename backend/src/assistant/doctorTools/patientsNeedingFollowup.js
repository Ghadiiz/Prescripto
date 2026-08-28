import { z } from 'zod';
import {
  findPatientsNeedingFollowup,
  FOLLOWUP_RESULT_LIMIT,
} from '../models/doctorScheduleQueries.js';
import { sanitizeAdminText } from '../guardrails/sanitize.js';
import { toDateString } from '../tools/dates.js';
import { requireDoctor } from './requireDoctor.js';

const DEFAULT_SINCE_DAYS = 30;
const DEFAULT_LIMIT = 20;

const schema = z
  .object({
    since_days: z.number().int().min(7).max(365).optional(),
    limit: z.number().int().min(1).max(FOLLOWUP_RESULT_LIMIT).optional(),
  })
  .strict();

export default {
  name: 'patients_needing_followup',
  description:
    'List the signed-in doctor\'s own patients whose last completed visit ' +
    `was at least since_days ago (default ${DEFAULT_SINCE_DAYS}) and who have ` +
    'nothing booked with them since. Ordered by longest wait first. Returns ' +
    'the patient name, the date of their last visit and how many visits they ' +
    'have completed — no contact details, so booking or contacting anyone is ' +
    'something the doctor does in the panel, not something you can do here. ' +
    `Returns at most ${FOLLOWUP_RESULT_LIMIT}.`,
  schema,
  mutates: false,

  handler: async (ctx, args) => {
    const denied = requireDoctor(ctx);
    if (denied) return { ...denied, patients: [] };

    const sinceDays = args.since_days ?? DEFAULT_SINCE_DAYS;
    const limit = args.limit ?? DEFAULT_LIMIT;

    const rows = await findPatientsNeedingFollowup(
      ctx.doctorId,
      sinceDays,
      limit,
    );

    return {
      checked_at: new Date().toISOString(),
      since_days: sinceDays,
      patient_count: rows.length,
      patients: rows.map((row) =>
        // No user_id and no email. A doctor recognises their own patient by
        // name and last visit; an id the model could carry into another call
        // is exactly what 5.2 meant by "a column that never ships cannot leak".
        sanitizeAdminText({
          patient_name: row.patient_name,
          last_visit_date: toDateString(new Date(row.last_visit_date)),
          days_since: Number(row.days_since),
          completed_visits: Number(row.completed_visits),
        }),
      ),
    };
  },
};
