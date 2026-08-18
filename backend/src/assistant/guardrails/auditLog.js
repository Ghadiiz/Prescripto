import { getDB } from '../../config/mysql.js';

// Rule 8: every tool call is logged — session, user, tool name, arguments,
// result count, timestamp. Argument VALUES and result COUNTS only: results are
// exactly the appointments and doctor text we are being careful about, and the
// audit log must not become a second place they accumulate.

// Connection-level failures. The DB layer has no mid-session reconnect (see
// the known issue in docs/agent-plan.md), so these are retried briefly here
// rather than being reported as an audit failure on the first blip.
const TRANSIENT_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_LOCK_DEADLOCK',
]);

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransient = (error) =>
  TRANSIENT_CODES.has(error?.code) || TRANSIENT_CODES.has(error?.errno);

// Throws if the row cannot be written. Callers must treat that as fatal to the
// tool call: no tool output may escape unlogged.
export const logToolCall = async ({
  sessionId,
  userId,
  role,
  toolName,
  args,
  resultCount,
}) => {
  const db = getDB();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await db.query(
        `INSERT INTO assistant_audit_log
          (session_id, user_id, role, tool_name, arguments, result_count)
         VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
        [
          sessionId,
          userId,
          role,
          toolName,
          JSON.stringify(args ?? null),
          resultCount,
        ],
      );
      return;
    } catch (error) {
      // A missing or malformed audit table is a misconfiguration. Surface it
      // immediately rather than retrying into the same wall.
      if (!isTransient(error) || attempt === MAX_ATTEMPTS) {
        console.error(
          `AUDIT WRITE FAILED (${error.code ?? 'unknown'}) for tool ` +
            `"${toolName}" after ${attempt} attempt(s): ${error.message}`,
        );
        throw error;
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
};
