import { getDB } from '../../config/mysql.js';

// SQL for in-app notifications.
//
// EVERY statement in this file is scoped by user_id, and that scoping lives in
// the WHERE clause rather than in a check the caller performs first.
//
// The difference matters most on the writes. The pattern used elsewhere in the
// app (appointmentService.cancelAppointment) fetches the row, compares
// `user_id`, and throws 403 — which works, but leaves three things open that
// this does not:
//
//   1. a gap between the check and the write,
//   2. a code path where someone could forget the comparison,
//   3. an existence leak, because 404-vs-403 tells a caller whether an id
//      exists at all.
//
// Here the scoping IS the statement. There is no version of these queries that
// touches another patient's row.

// A patient will not scroll past this in a bell dropdown, and it bounds the
// response whatever the history looks like.
export const NOTIFICATION_LIST_LIMIT = 50;

// Explicit column list per the house rule. `user_id` is deliberately absent:
// the client already knows who it is, and a column that never ships cannot
// leak.
const NOTIFICATION_COLUMNS = `
      id,
      type,
      payload,
      read_at,
      created_at`;

export const findNotificationsForUser = async (userId) => {
  const db = getDB();

  const [rows] = await db.query(
    `SELECT
${NOTIFICATION_COLUMNS}
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ${NOTIFICATION_LIST_LIMIT}`,
    [userId],
  );

  return rows;
};

// Runs on every poll from every open tab, so it is deliberately the narrowest
// query in the file: a count over idx_unread (user_id, read_at, created_at),
// touching no row data.
export const countUnreadForUser = async (userId) => {
  const db = getDB();

  const [[row]] = await db.query(
    'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [userId],
  );

  return row.unread;
};

// `AND user_id = ?` is the security boundary. `AND read_at IS NULL` makes it
// idempotent — marking an already-read notification changes nothing rather
// than moving its timestamp.
//
// Returns whether a row changed. The caller deliberately does NOT turn a 0 into
// a 404: see the note at the top about existence leaks.
export const markNotificationRead = async (notificationId, userId) => {
  const db = getDB();

  const [result] = await db.query(
    `UPDATE notifications
        SET read_at = NOW()
      WHERE id = ? AND user_id = ? AND read_at IS NULL`,
    [notificationId, userId],
  );

  return result.affectedRows > 0;
};

export const markAllNotificationsRead = async (userId) => {
  const db = getDB();

  const [result] = await db.query(
    `UPDATE notifications
        SET read_at = NOW()
      WHERE user_id = ? AND read_at IS NULL`,
    [userId],
  );

  return result.affectedRows;
};

// The write side. Called by the waitlist notifier (5.4), never by a request
// handler — a patient cannot create their own notifications.
export const insertNotification = async (userId, type, payload) => {
  const db = getDB();

  const [result] = await db.query(
    'INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, CAST(? AS JSON))',
    [userId, type, JSON.stringify(payload ?? null)],
  );

  return result.insertId;
};
