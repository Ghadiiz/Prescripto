-- 007 — a time-of-day window on the waitlist.
--
-- 006 let a patient wait on a DATE RANGE. 7.4 lets them wait on HOURS within
-- it: "mornings, Sep 1-7". The bounds apply to EVERY date in the range, which
-- is what a patient means — the other reading (one continuous span from Sep 1
-- at 10:00 to Sep 7 at 14:00, taking in Sep 3 at 20:00) is never the request.
--
-- Both NULL means the whole day. Every row 006 created becomes exactly that,
-- so this migration changes no existing behaviour.
--
--
-- THE TRAP THIS MIGRATION IS SHAPED AROUND
--
-- `active_request` is what makes "you are already on this list" a DATABASE
-- guarantee rather than a read-then-write check in the tool. It is a CONCAT,
-- and in MySQL `CONCAT('a', NULL)` is NULL — while a UNIQUE index ignores
-- NULLs entirely.
--
-- So adding nullable time columns to that CONCAT naively would set
-- `active_request` to NULL for every whole-day row, and the uniqueness
-- guarantee would silently switch OFF for exactly the rows that existed
-- before. Nothing would look broken. Duplicates would simply start being
-- accepted.
--
-- Hence COALESCE on both time components. `migration007.test.js` asserts the
-- whole-day collision directly, because a comment is not a guarantee.


-- The generated column has to be rebuilt, and its index with it.
ALTER TABLE waitlist DROP INDEX unique_active_request;
ALTER TABLE waitlist DROP COLUMN active_request;

ALTER TABLE waitlist
  -- Inclusive, like date_from/date_to above them: "between 10 and 2" includes
  -- a 2 o'clock slot, which is how the phrase reads to the person saying it.
  ADD COLUMN time_from TIME NULL DEFAULT NULL AFTER date_to,
  ADD COLUMN time_to   TIME NULL DEFAULT NULL AFTER time_from;

ALTER TABLE waitlist
  ADD COLUMN active_request VARCHAR(128) GENERATED ALWAYS AS (
    CASE WHEN status = 'cancelled' THEN NULL
         ELSE CONCAT(
           user_id, '_', doctor_id, '_', date_from, '_', date_to, '_',
           -- COALESCE, not the bare column. See the note above: without it a
           -- whole-day row's key becomes NULL and stops being unique at all.
           COALESCE(time_from, ''), '_', COALESCE(time_to, '')
         )
    END
  ) VIRTUAL;

ALTER TABLE waitlist ADD UNIQUE KEY unique_active_request (active_request);

-- Both bounds or neither. A half-specified window would leave the notifier's
-- match predicate meaningless — `time BETWEEN '10:00:00' AND NULL` is NULL,
-- which is neither true nor false and would quietly match nothing.
ALTER TABLE waitlist
  ADD CONSTRAINT chk_waitlist_time_pair
  CHECK ((time_from IS NULL) = (time_to IS NULL));

-- The time equivalent of chk_waitlist_range. A reversed window would match
-- nothing forever, and the patient would never learn why.
ALTER TABLE waitlist
  ADD CONSTRAINT chk_waitlist_time_range
  CHECK (time_to IS NULL OR time_to >= time_from);
