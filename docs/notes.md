## Phase 0 Notes

### 0.1 — Verify commands and confirm the app runs locally

Checked the run commands in `CLAUDE.md` against what the project actually uses and fixed the wrong ones (backend runs with `npm run server`; there's no test suite). Added a root `.env.example` so anyone cloning the repo knows which variables Docker Compose needs. Ran `docker compose up --build` locally and confirmed all four containers start and both frontends load — the part that couldn't be verified in the sandbox.

### 0.2 — Migration runner and doctor profile fields

Added a migration system: `migrate.js` applies SQL files from `database/migrations/` and records each in a `schema_migrations` table so it never runs twice. Migration `001` adds three optional columns to the `doctors` table — `experience_years`, `languages`, `gender` — and backfills `experience_years` by converting the old text values (e.g. `"4 Years"` → `4`). Verified locally, then applied to the live Aiven database as a careful canary run: took a backup first, confirmed the columns and backfill worked, and checked the live site still ran.

### 0.3 — Speciality keywords table

Added migration `002_speciality_keywords.sql`: a `speciality_keywords` table mapping common, non-diagnostic patient phrasings (e.g. "rash", "headache", "back pain") to the six existing specialities. This is the entire vocabulary behind the future `suggest_speciality` tool — anything not in the list becomes a "no match", so it's meant to be expanded over time. Two deliberate design choices: rows are inserted by joining on speciality _name_ rather than hardcoded IDs (so it stays correct even if Aiven's speciality IDs differ from local), and the unique key is composite `(keyword, speciality_id)` so a term like "vaccination" can legitimately map to more than one speciality. Emergency phrasings (chest pain, difficulty breathing) are deliberately left out — those are handled by the emergency guardrail in Phase 2, not by speciality routing. Verified locally; not yet applied to Aiven (batched for the Phase 0 boundary).

### 0.4 — Assistant audit log and conversations tables

Added migration `003_assistant_tables.sql`: `assistant_audit_log` (records every assistant tool call — session, user, role, tool name, arguments, result count, time) and `conversations` (stores chat history as JSON per user). One deliberate change from the original plan: `conversations` is keyed on `(user_id, role)`, not `user_id` alone. Patient IDs come from the `users` table and doctor IDs from the `doctors` table, and those ID ranges overlap — so without `role`, patient #5 and doctor #5 would share one conversation history once doctors get their own assistant in Phase 5. Neither table has a foreign key on `user_id` (there's no single table to point at), and for the audit log that's intentional — deleting an account shouldn't erase its audit trail. Verified locally (JSON columns work, indexes used, NULL vs 0 result counts stored distinctly); not yet applied to Aiven.

### 0.5 — Seed data: Amman addresses and doctor fields

Rewrote the seed so all 16 doctors have realistic Amman addresses (Abdali, Shmeisani, Sweifieh, Khalda, Jabal Amman) and populated values for the new fields — `experience_years`, `languages`, `gender`, and a new `area` column (added by migration `004_doctors_area.sql`). The data is deliberately varied so the assistant's future search filters actually discriminate: five districts, a mix of Arabic/English/French speakers, and a gender split, with every area spanning multiple specialities. `address_line2` is derived as `<area>, Amman` so the area column and the address text can't drift apart. The shared `about` paragraph was refactored from 16 copy-pastes into two constants, with the stored text verified byte-for-byte identical. Verified locally; migrations 002–004 not yet applied to Aiven (batched for the Phase 0 boundary).
