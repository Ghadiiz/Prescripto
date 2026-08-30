import { getDB } from '../../config/mysql.js';

// SQL for the waitlist. The only file in the assistant that writes.
//
// `userId` is bound first and always comes from ctx — the same discipline
// appointmentQueries applies to reads, now with a row being created rather
// than returned.
//
// THE SCHEMA IS BROADER THAN THE FEATURE, DELIBERATELY.
//
// `waitlist` stores a DATE RANGE and a TIME WINDOW (007). The product is
// SINGLE SLOT: 7.5 decided a patient always has a specific time in mind, so
// the assistant narrows a vague request with `check_availability` and only
// then writes one row — stored as the degenerate case `date_from == date_to`
// and `time_from == time_to`.
//
// The range columns were NOT migrated away, and that is a decision rather than
// an oversight. Removing them would mean a second production migration on this
// table, rebuilding the generated `active_request` column and its unique index
// again, with the recovery risk that carries — to gain nothing but tidiness. A
// single-slot row is valid data: the unique key and both CHECK constraints
// hold on it exactly as they do on a range.
//
// So ranges are DORMANT, not gone. `waitlistMatchModel.js` still matches them
// and is still tested against them, because rows written before 7.5 are
// ranges, and because re-enabling the capability later would mean relaxing a
// guard in `tools/joinWaitlist.js` rather than migrating a live table.
//
// **The single-slot rule is enforced at the TOOL, not here.** This function
// will write whatever it is given, as it must — a model layer that second-
// guessed its caller would be a second place for the rule to live, and the two
// would eventually disagree.

export const insertWaitlistEntry = async (
  userId,
  doctorId,
  dateFrom,
  dateTo,
  // 7.4. Both NULL means the whole day, which is what every row 006 wrote
  // means. The database CHECKs that they are both set or both absent.
  timeFrom = null,
  timeTo = null,
) => {
  const db = getDB();

  // No SELECT-then-INSERT. 006's `unique_active_request` generated column
  // makes a duplicate an ER_DUP_ENTRY, so two concurrent attempts resolve to
  // one row and one clean error — the same guarantee appointments.active_slot
  // gives booking. Checking first would add a race, not remove one.
  //
  // 007 put the times INTO that key, so "already on this list" now means the
  // same doctor, dates AND hours — mornings and afternoons are two requests.
  const [result] = await db.query(
    `INSERT INTO waitlist
       (user_id, doctor_id, date_from, date_to, time_from, time_to, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [userId, doctorId, dateFrom, dateTo, timeFrom, timeTo],
  );

  return result.insertId;
};
