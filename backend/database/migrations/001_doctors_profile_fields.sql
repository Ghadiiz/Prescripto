-- 001 — doctor profile fields for the assistant's search tool.
--
-- Adds numeric experience, languages and gender to `doctors`. The old
-- `experience` VARCHAR ('4 Years') stays: the admin panel, doctor profile and
-- appointment service still read it. `experience_years` is the comparable one.
--
-- `languages` is a comma-separated list, e.g. 'English,Arabic'. Queries use
-- FIND_IN_SET, so store the values without spaces around the commas.
-- `gender` and `languages` are populated by the seed script (0.5) and the
-- admin forms (0.6); this migration only creates them.

ALTER TABLE doctors
  ADD COLUMN experience_years INT NULL AFTER experience,
  ADD COLUMN languages VARCHAR(255) NULL AFTER experience_years,
  ADD COLUMN gender ENUM('Male','Female') NULL AFTER languages;

-- Backfill from the leading number in the old string. Rows whose `experience`
-- holds no digits (or is NULL) are left NULL rather than guessed at.
UPDATE doctors
   SET experience_years = CAST(REGEXP_SUBSTR(experience, '[0-9]+') AS UNSIGNED)
 WHERE experience_years IS NULL
   AND REGEXP_SUBSTR(experience, '[0-9]+') IS NOT NULL;
