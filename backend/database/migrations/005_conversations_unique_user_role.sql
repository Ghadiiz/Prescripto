-- 005 — one conversation row per (user_id, role).
--
-- 003 created `idx_user (role, user_id, updated_at)` for lookup, but it is not
-- unique, so nothing stops a second row for the same pair. Conversation
-- storage upserts with INSERT ... ON DUPLICATE KEY UPDATE, which needs a
-- unique key to match against — without it every save would insert a new row
-- and history would fragment silently.
--
-- The pair is the key, never user_id alone: patient ids come from `users` and
-- doctor ids from `doctors` with overlapping id spaces, so patient #5 and
-- doctor #5 are different people (see 0.4).

ALTER TABLE conversations
  ADD UNIQUE KEY uniq_user_role (user_id, role);
