import { z } from 'zod';
import { findStatsForDoctor } from '../models/doctorScheduleQueries.js';
import { toDateString, addDays } from '../tools/dates.js';
import { requireDoctor } from './requireDoctor.js';

const PERIODS = ['last_7_days', 'last_30_days', 'this_month', 'all_time'];
const DEFAULT_PERIOD = 'last_30_days';

const schema = z
  .object({
    period: z.enum(PERIODS).optional(),
  })
  .strict();

// Resolved here rather than in SQL so the window the numbers describe can be
// returned alongside them. "You completed 12" means little without "between
// these two dates".
const resolvePeriod = (period, now = new Date()) => {
  const today = toDateString(now);

  if (period === 'all_time') {
    // Wide enough to cover any row the app could hold, without a second query
    // shape for the unbounded case.
    return { from: '1000-01-01', to: '9999-12-31' };
  }

  if (period === 'this_month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: toDateString(first), to: toDateString(last) };
  }

  const days = period === 'last_7_days' ? 7 : 30;

  // Inclusive of today, so last_7_days is today plus the six before it.
  return { from: toDateString(addDays(today, -(days - 1))), to: today };
};

export default {
  name: 'my_stats',
  description:
    "Summarise the signed-in doctor's own practice over a period: total " +
    'appointments, how many were completed or cancelled, how many are still ' +
    'upcoming, how many distinct patients, and earnings from completed ' +
    `appointments. period is one of ${PERIODS.join(', ')} and defaults to ` +
    `${DEFAULT_PERIOD}. Counts only this doctor's own appointments — it ` +
    'cannot compare them to another doctor or to the clinic as a whole.',
  schema,
  mutates: false,

  handler: async (ctx, args) => {
    const denied = requireDoctor(ctx);
    if (denied) return denied;

    const period = args.period ?? DEFAULT_PERIOD;
    const { from, to } = resolvePeriod(period);

    const row = await findStatsForDoctor(ctx.doctorId, from, to);

    return {
      checked_at: new Date().toISOString(),
      period,
      from,
      to,
      appointments_total: Number(row.appointments_total),
      completed: Number(row.completed),
      cancelled: Number(row.cancelled),
      // Only meaningful when the period reaches into the future; for
      // last_30_days it is 0 by construction, which is honest rather than
      // hidden.
      upcoming: Number(row.upcoming),
      distinct_patients: Number(row.distinct_patients),
      // The fee actually charged at booking, summed over completed
      // appointments — not today's list price applied retroactively.
      earnings: Number(row.earnings),
    };
  },
};
