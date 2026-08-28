// The consulting-hours grid, as schedule_gaps needs to see it.
//
// CLAUDE.md: slots are GENERATED, not stored — 10:00-21:00 in half hours, the
// same for every doctor, built inline in appointmentService.getAvailableSlots.
// That stays true; this file does not introduce a schedule.
//
// Why not simply call getAvailableSlots:
//
//   - it THROWS when `doctors.available = 0`, and a doctor who has stopped
//     accepting new bookings still has a schedule they can ask about;
//   - it returns 12-hour display strings ('02:30 PM'), and gaps have to be
//     arithmetic before they are text.
//
// So the grid is restated here rather than the booking flow being refactored
// mid-increment. The duplication is real and is pinned by a test: for a doctor
// with no bookings, getAvailableSlots' own boundaries must match this grid. If
// someone changes the hours in one place, that test fails instead of the two
// silently disagreeing.

export const WORKING_HOURS = { start: '10:00', end: '21:00' };
export const SLOT_MINUTES = 30;

const toMinutes = (hhmm) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};

export const toHHMM = (minutes) => {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

const DAY_START = toMinutes(WORKING_HOURS.start);
const DAY_END = toMinutes(WORKING_HOURS.end);

// Every slot START in the day, as minutes past midnight.
//
// `now` is injectable so a test can pin the today-trimming without waiting for
// the clock. Production passes nothing.
export const slotStartsForDate = (dateString, now = new Date()) => {
  let first = DAY_START;

  const today =
    dateString ===
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;

  // The same rounding getAvailableSlots does: a slot that has already started
  // is not free, so today begins at the next half hour rather than at 10:00.
  if (today) {
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    if (minutesNow > first) {
      first = Math.ceil(minutesNow / SLOT_MINUTES) * SLOT_MINUTES;
    }
  }

  const starts = [];
  for (let minute = first; minute < DAY_END; minute += SLOT_MINUTES) {
    starts.push(minute);
  }

  return starts;
};

// Contiguous runs of free slots, collapsed into blocks.
//
// A doctor asking "when am I free?" wants "13:00-15:00", not four half hours
// listed separately. `end` is the end of the last slot in the run, so a block
// is bookable for its whole stated length.
export const mergeIntoBlocks = (freeStarts) => {
  const blocks = [];

  for (const start of freeStarts) {
    const previous = blocks[blocks.length - 1];

    if (previous && previous.endMinutes === start) {
      previous.endMinutes = start + SLOT_MINUTES;
      continue;
    }

    blocks.push({ startMinutes: start, endMinutes: start + SLOT_MINUTES });
  }

  return blocks.map((block) => ({
    start: toHHMM(block.startMinutes),
    end: toHHMM(block.endMinutes),
    minutes: block.endMinutes - block.startMinutes,
  }));
};
