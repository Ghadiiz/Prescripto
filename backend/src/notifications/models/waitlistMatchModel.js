import { getDB } from '../../config/mysql.js';

// Reading the waitlist to decide who to tell about a freed slot.
//
// The waitlist is WRITTEN by the assistant's join_waitlist tool and READ here,
// so the query lives with the notifier that uses it rather than beside the
// insert.
//
// THE RANGE MATCHING BELOW IS DORMANT, AND STAYS ON PURPOSE. Since 7.5 the
// tool only writes SINGLE SLOTS (`date_from == date_to`,
// `time_from == time_to`), so in production these predicates mostly compare a
// date and a time against themselves. They are kept, and kept tested, because
// rows written before 7.5 are genuine ranges, whole-day rows from before 7.4
// have NULL time bounds, and the schema still permits both. See the note in
// `assistant/models/waitlistQueries.js` for why the columns were not migrated
// away.

// Shaped to match 006's `idx_match (doctor_id, status, date_from, date_to)`:
// equality on the first two columns, the range last. That index was created
// for this query specifically, and a test asserts EXPLAIN still picks it —
// this runs inside a cancellation, which a patient is waiting on.
export const findActiveWaitlistForSlot = async (doctorId, date, time = null) => {
  const db = getDB();

  // 7.4 added the time predicate. Two ways a row still matches without one:
  //
  //   `time_from IS NULL` — a whole-day request, which is every row 006 wrote
  //   and every request that names no hours.
  //
  //   `? IS NULL` — the freed time is unknown, which happens for a job
  //   enqueued before 7.2. Matching everything is the right answer there: the
  //   slot did open, and the alternative is telling nobody.
  //
  // BETWEEN is inclusive at both ends, deliberately. "Between 10 and 2"
  // includes a 2 o'clock slot to the person who said it.
  const [rows] = await db.query(
    `SELECT id, user_id, date_from, date_to, time_from, time_to
       FROM waitlist
      WHERE doctor_id = ?
        AND status = 'active'
        AND date_from <= ?
        AND date_to >= ?
        AND (? IS NULL OR time_from IS NULL OR ? BETWEEN time_from AND time_to)`,
    [doctorId, date, date, time, time],
  );

  return rows;
};

// Used to avoid stacking a second unread notification about the same doctor
// and date on someone who has not looked at the first one.
//
// A check-then-insert, so two cancellations for the same day landing at once
// could both pass it. The worst case is one extra notification — not worth a
// migration to make exact, and stated in the notifier rather than implied.
export const findUsersWithUnreadSlotNotice = async (userIds, doctorId, date) => {
  if (userIds.length === 0) return new Set();

  const db = getDB();

  const [rows] = await db.query(
    `SELECT DISTINCT user_id
       FROM notifications
      WHERE user_id IN (?)
        AND read_at IS NULL
        AND type = 'waitlist_slot_open'
        AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.doctor_id')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.date')) = ?`,
    [userIds, String(doctorId), date],
  );

  return new Set(rows.map((row) => row.user_id));
};
