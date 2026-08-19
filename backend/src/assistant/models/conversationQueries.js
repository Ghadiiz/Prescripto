import { getDB } from '../../config/mysql.js';

// SQL for conversation history.
//
// EVERY query scopes on BOTH user_id AND role. Patient ids come from `users`
// and doctor ids from `doctors`, and those id spaces overlap — so `user_id`
// alone would let patient #5 read doctor #5's conversation. That is the exact
// bug the role column was added to prevent in 0.4, and it is only prevented if
// every query here actually uses it.

export const loadConversation = async (userId, role) => {
  const db = getDB();

  const [rows] = await db.query(
    'SELECT messages FROM conversations WHERE user_id = ? AND role = ? LIMIT 1',
    [userId, role],
  );

  // mysql2 parses a JSON column into a value; guard anyway so a hand-edited
  // row cannot crash a conversation.
  const messages = rows[0]?.messages;
  return Array.isArray(messages) ? messages : [];
};

// Upsert, so one row per (user_id, role) — relies on the unique key added by
// migration 005. Without it this would insert a new row on every save and the
// history would fragment without anything looking broken.
export const saveConversation = async (userId, role, messages) => {
  const db = getDB();

  await db.query(
    `INSERT INTO conversations (user_id, role, messages)
     VALUES (?, ?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE messages = VALUES(messages)`,
    [userId, role, JSON.stringify(messages)],
  );
};

// 30-day retention. Uses idx_updated_at from 003, so this is a range scan
// rather than a table scan.
//
// Conversations expire; audit rows do NOT. That asymmetry is deliberate (1.7):
// the audit log is a security record, not a copy of the chat.
export const purgeExpiredConversations = async (days = 30) => {
  const db = getDB();

  const [result] = await db.query(
    'DELETE FROM conversations WHERE updated_at < NOW() - INTERVAL ? DAY',
    [days],
  );

  return result.affectedRows;
};
