## Phase 0 Notes

### 0.1 — Verify commands and confirm the app runs locally

Checked the run commands in `CLAUDE.md` against what the project actually uses and fixed the wrong ones (backend runs with `npm run server`; there's no test suite). Added a root `.env.example` so anyone cloning the repo knows which variables Docker Compose needs. Ran `docker compose up --build` locally and confirmed all four containers start and both frontends load — the part that couldn't be verified in the sandbox.

### 0.2 — Migration runner and doctor profile fields

Added a migration system: `migrate.js` applies SQL files from `database/migrations/` and records each in a `schema_migrations` table so it never runs twice. Migration `001` adds three optional columns to the `doctors` table — `experience_years`, `languages`, `gender` — and backfills `experience_years` by converting the old text values (e.g. `"4 Years"` → `4`). Verified locally, then applied to the live Aiven database as a careful canary run: took a backup first, confirmed the columns and backfill worked, and checked the live site still ran.
