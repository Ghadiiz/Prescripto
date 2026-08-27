import { getDB } from '../../config/mysql.js';

// SQL for the waitlist. The only file in the assistant that writes.
//
// `userId` is bound first and always comes from ctx — the same discipline
// appointmentQueries applies to reads, now with a row being created rather
// than returned.

export const insertWaitlistEntry = async (userId, doctorId, dateFrom, dateTo) => {
  const db = getDB();

  // No SELECT-then-INSERT. 006's `unique_active_request` generated column
  // makes a duplicate an ER_DUP_ENTRY, so two concurrent attempts resolve to
  // one row and one clean error — the same guarantee appointments.active_slot
  // gives booking. Checking first would add a race, not remove one.
  const [result] = await db.query(
    `INSERT INTO waitlist (user_id, doctor_id, date_from, date_to, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [userId, doctorId, dateFrom, dateTo],
  );

  return result.insertId;
};
