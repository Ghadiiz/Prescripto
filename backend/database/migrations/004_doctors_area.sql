-- 004 — doctors.area, for the assistant's area search filter (1.2).
--
-- A dedicated column rather than a LIKE against address_line2: it stays
-- correct regardless of how an admin formats the rest of the address, and it
-- can be indexed.
--
-- Nullable and NOT backfilled. Existing production rows carry addresses with
-- no district to derive, and inventing one would be worse than a NULL — they
-- get filled in through the admin forms in 0.6. 1.2 must therefore read a NULL
-- area as "unknown", never as "matches nothing".

ALTER TABLE doctors
  ADD COLUMN area VARCHAR(100) NULL AFTER address_line2,
  ADD KEY idx_area (area);
