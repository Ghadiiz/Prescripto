-- 003 — assistant audit log and conversation storage.
--
-- IDENTITY: patient ids come from `users`, doctor ids come from `doctors` —
-- separate tables with overlapping id spaces. The JWT carries { id, email,
-- role }, so ctx = { userId, role } only identifies someone as a PAIR. Both
-- tables therefore carry `role` alongside `user_id`, and neither can have a
-- foreign key on `user_id` — there is no single table to reference.
--
-- For the audit log that is the right behaviour regardless: an audit row must
-- outlive the account it describes. A CASCADE would erase the trail at exactly
-- the moment it matters most.

-- Rule 8: every tool call is logged — session, user, tool name, arguments,
-- result count, timestamp. Argument VALUES and result COUNTS only; there is
-- deliberately no column for result contents.
CREATE TABLE assistant_audit_log (
  -- BIGINT: one chat turn can produce several tool calls, so this table grows
  -- faster than anything else in the schema.
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  -- Opaque UUID minted per chat session by the endpoint (2.7), NOT a foreign
  -- key to conversations: audit rows are written before any conversation row
  -- exists, and must survive the 30-day conversation retention cut.
  session_id CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  role ENUM('patient','doctor') NOT NULL,
  tool_name VARCHAR(64) NOT NULL,
  arguments JSON,
  -- NULL means the tool errored and produced no result set. Distinct from 0,
  -- which means it ran fine and found nothing. 1.7 must preserve that.
  result_count INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- "Everything that happened in this session."
  KEY idx_session (session_id),
  -- Leads with role because every lookup is role-scoped. Also serves 2.7's
  -- per-user rate-limit count without needing a second index.
  KEY idx_user (role, user_id, created_at),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- 2.6: last 10 turns per user, 30-day retention. Retention is enforced in
-- application code, not by a MySQL EVENT — the indexes below are what make
-- that delete a range scan rather than a table scan.
--
-- Note the asymmetry: conversations expire, audit rows do not. The audit log
-- is a security record, not a copy of the chat.
CREATE TABLE conversations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  -- Without this column, patient #5 and doctor #5 would share one history
  -- once Phase 5 lands. See the identity note at the top of this file.
  role ENUM('patient','doctor') NOT NULL,
  messages JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user (role, user_id, updated_at),
  KEY idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
