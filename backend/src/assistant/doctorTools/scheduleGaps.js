import { z } from 'zod';
import { findBookedTimesForDoctor } from '../models/doctorScheduleQueries.js';
import { toDateString, addDays, isBeforeToday } from '../tools/dates.js';
import {
  WORKING_HOURS,
  SLOT_MINUTES,
  slotStartsForDate,
  mergeIntoBlocks,
} from './hours.js';
import { requireDoctor } from './requireDoctor.js';

const MAX_DAYS = 7;

const schema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
      .optional(),
    days: z.number().int().min(1).max(MAX_DAYS).optional(),
    // A doctor asking where they could fit someone in usually has a length in
    // mind. Filtering here beats returning every stray half hour.
    min_minutes: z.number().int().min(SLOT_MINUTES).max(600).optional(),
  })
  .strict();

// 'HH:MM:SS' from the database to minutes past midnight, to compare against
// the grid.
const timeToMinutes = (value) => {
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
};

export default {
  name: 'schedule_gaps',
  description:
    "Find the free blocks in the signed-in doctor's own day — the consulting " +
    `hours (${WORKING_HOURS.start}-${WORKING_HOURS.end}) minus their booked ` +
    'appointments, merged into contiguous blocks. Defaults to today, and ' +
    `covers up to ${MAX_DAYS} consecutive days. Use min_minutes to ask only ` +
    'for blocks at least that long. This is a snapshot taken at checked_at, ' +
    'not a hold: a patient can book any of these slots at any moment, so ' +
    'never describe a gap as reserved or kept free.',
  schema,
  mutates: false,

  handler: async (ctx, args) => {
    const denied = requireDoctor(ctx);
    if (denied) return { ...denied, dates: [] };

    const days = args.days ?? 1;
    const from = args.date ?? toDateString(new Date());
    const minMinutes = args.min_minutes ?? SLOT_MINUTES;

    // Taken before the loop so every date in one response shares it.
    const checkedAt = new Date().toISOString();
    const dates = [];

    for (let offset = 0; offset < days; offset += 1) {
      const date = toDateString(addDays(from, offset));

      // A day that has already gone has no gaps to offer. Without this the
      // grid would report a past date as eleven hours wide open — the same
      // bug getAvailableSlots has for past dates (see Known issues).
      if (isBeforeToday(date)) {
        dates.push({ date, gaps: [], total_free_minutes: 0, reason: 'date_in_past' });
        continue;
      }

      const booked = new Set(
        (await findBookedTimesForDoctor(ctx.doctorId, date)).map(timeToMinutes),
      );

      const free = slotStartsForDate(date).filter((start) => !booked.has(start));
      const gaps = mergeIntoBlocks(free).filter(
        (block) => block.minutes >= minMinutes,
      );

      dates.push({
        date,
        gaps,
        total_free_minutes: gaps.reduce((sum, block) => sum + block.minutes, 0),
      });
    }

    return {
      checked_at: checkedAt,
      working_hours: WORKING_HOURS,
      slot_minutes: SLOT_MINUTES,
      min_minutes: minMinutes,
      // Stated in the result, not only in the description: the same hours for
      // every doctor is a property of this system, and a doctor reading "you
      // are free 10:00-11:00" should be able to see where that came from.
      note: `Consulting hours are ${WORKING_HOURS.start}-${WORKING_HOURS.end} ` +
        'for every doctor. Gaps are a snapshot, not a reservation.',
      dates,
    };
  },
};
