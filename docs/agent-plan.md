# AI Assistant — Build Plan

Seven phases, each broken into increments. **One increment per Claude Code
session.** Tick boxes as they complete.

Scope decisions already made:
- Assistant is **login-only**. No anonymous access.
- **English only.** No Arabic UI. (`doctors.languages` is still a search filter.)
- Doctors get their own assistant (Phase 5).
- **Doctor hours are fixed** (10:00–21:00, same for all). No `doctor_schedules`
  table; slot generation is not changed.
- Waitlist notifies **in-app**, not by email.
- Provider is **Gemini free tier** during development.

Phases 0–4 alone are a complete, demonstrable project. 5–7 are additive.

---

## Production state (Aiven)

Which migrations have been applied to the **Aiven production database**. Local
and production are migrated separately — `npm run migrate` from a dev machine
hits whatever `backend/.env` points at, which is normally local MySQL.

**All four Phase 0 migrations are applied** (as of 2026-08-16). The
`schema_migrations` ledger on Aiven holds all four rows, so re-running the
runner there is a no-op — and **do not re-apply any of them by hand**: the
`ALTER`/`CREATE` statements would fail on duplicate columns and tables.

- **001_doctors_profile_fields.sql** — `experience_years`, `languages` and
  `gender` on `doctors`; the backfill converted the `experience` strings to
  integers. Applied early and alone, as a canary for the runner against a
  managed host.
- **002_speciality_keywords.sql** — `speciality_keywords` table, **populated**
  with the routing terms.
- **003_assistant_tables.sql** — `assistant_audit_log` and `conversations`
  exist and are **empty**, awaiting the tool layer in Phase 1 and the chat
  endpoint in 2.7.
- **004_doctors_area.sql** — `doctors.area` and `idx_area` exist, but **`area`
  is NULL on every production row**. 004 ships without a backfill, and the seed
  script — the only thing that populates `area`, `languages` and `gender` —
  never runs against production. Those get filled in through the 0.6 admin
  forms, one doctor at a time.

  Until that happens, 1.2's area, language and gender filters match nothing on
  production while working fine locally. Read a NULL as "unknown", never as "no
  match".

`npm run seed` must never run against Aiven — it opens with `DELETE FROM` on all
four tables. Since 0.7 this is enforced rather than trusted: `database/seed.js`
refuses to run unless `DB_HOST` is `localhost` or `127.0.0.1`, aborting before
it opens a connection.

---

## Phase 0 — Database and seed data

Close the schema gaps so nothing later needs a workaround.

- [x] **0.1** Verify and fill in the Commands section of `CLAUDE.md` from
      `package.json` and `docker-compose.yml`. Confirm the app runs locally.
- [x] **0.2** Migration: add `experience_years INT`, `languages VARCHAR`,
      `gender ENUM` to `doctors`. Backfill `experience_years` from the existing
      `experience` VARCHAR. Keep the old column for now. *Also established the
      migration mechanism the later increments reuse: `database/migrate.js`,
      `database/migrations/*.sql`, ledger in `schema_migrations`. **Applied to
      Aiven** — see Production state above.*
- [x] **0.3** Migration: create `speciality_keywords` (id, keyword,
      speciality_id, FK). Seed with ~40 common non-diagnostic terms mapping to
      existing specialities. *55 terms in `002_speciality_keywords.sql`, joined
      on speciality name rather than id. Emergency phrasings deliberately
      excluded — 2.4's `emergencyCheck` handles those. Local only; **not applied
      to Aiven**.*
- [x] **0.4** Migration: create `assistant_audit_log` (id, session_id, user_id,
      role, tool_name, arguments JSON, result_count, created_at) and
      `conversations` (id, user_id, **role**, messages JSON, created_at,
      updated_at). *Built as `003_assistant_tables.sql`, with three deviations
      from the shape above:*
      - *`conversations` is keyed on **(user_id, role)**, not `user_id` alone.
        Patient ids come from `users` and doctor ids from `doctors` — separate
        tables with overlapping id spaces — so `user_id` by itself is
        ambiguous, and patient #5 would share a history with doctor #5 once
        doctors get their own assistant in 5.6.*
      - ***Neither table has a FK on `user_id`** — there is no single table to
        reference. For `assistant_audit_log` this is also deliberate: deleting
        an account must not cascade-erase its audit trail.*
      - *`session_id` is an **opaque UUID string**, independent of
        `conversations` — audit rows are written before a conversation row
        exists and outlive the 30-day retention cut in 2.6.*
- [x] **0.5** Update the seed script: realistic Amman addresses (Abdali,
      Shmeisani, Sweifieh, Khalda, Jabal Amman), populate the new doctor
      columns. Add a "demo data" note. *Also added **migration 004** —
      `area VARCHAR(100)` + `idx_area` on `doctors` — which wasn't in this
      plan: 1.2's search takes an `area` filter and there was no column for it,
      and a `LIKE` against `address_line2` would be unindexable and would break
      on any admin who formats an address differently. The seed now populates
      `area`, `experience_years`, `languages` and `gender` on all 16 doctors,
      spread across the five districts with each area covering three
      specialities. `area` is nullable and unbackfilled, so 1.2 must read NULL
      as "unknown", not "no match".*
- [x] **0.6** Update admin panel doctor create/edit forms for the new fields.
- [x] **0.7** Fix the startup race in `server.js`: `app.listen()` runs before
      `connectDB()` resolves, so requests landing in that window fail with
      `Database not initialized` (`src/config/mysql.js`) behind a generic 500.
      Await the connection before accepting traffic, or gate requests on a
      readiness check that returns 503 until the pool is up — keeping the
      existing retry/backoff from commit `950f5e3`. Worst on a cold Render
      boot. *Found during 0.1.* *Built as the readiness gate: `isDBReady()` in
      `config/mysql.js` plus a `databaseReady` middleware mounted on `/api`,
      answering 503 + `Retry-After` until the connection resolves. `GET /` is
      deliberately ungated and `connectDB()` deliberately un-awaited, so the
      port binds immediately and platform health checks still pass. Side
      effect: unknown `/api/*` paths return 503 rather than 404 during the
      startup window.*
      - ***Seed guard added alongside it.** `database/seed.js` now refuses to
        run unless `DB_HOST` is `localhost` or `127.0.0.1`, aborting with exit
        1 before it opens a connection or issues any `DELETE`. The script wipes
        all four tables, so pointing it at Aiven would destroy production data
        — a real risk now that we are about to run migrations there. Added
        after a local database was wiped this way during 0.2.*
- [x] **0.8** Deferred cleanup (tracking only — **not blocking Phase 0**):
      - **Hardcoded form option data — DONE.** The admin forms used to hardcode
        their dropdown options (speciality IDs 7–12, plus the
        district/gender/language lists) in the JSX, mirrored by the enforcement
        constants in `constants/doctorOptions.js` — three places to edit, and a
        mismatch meant the form offering a value the API rejects with 400.
        *Fixed with `GET /api/admin/doctor-options` (admin-authed), which
        serves specialities from the `specialities` table and area/gender/
        language from the same constants the validators enforce. Both forms
        fetch via `AdminContext` and render every option from the response, so
        the list a form offers and the list the API accepts cannot diverge.
        The hardcoded speciality-id fallbacks are gone too — including the
        `|| '7'` default behind the 0.6 speciality-reset regression. Validation
        is unchanged and remains the enforcement layer.* *Found during 0.6.*
      - **Shared doctor phone number — STILL DEFERRED.** All 16 seeded doctors
        share `+962 79 000 0000` (`seed.js`). Cosmetic but visible in the live
        demo — give each a distinct placeholder or consciously accept it. Left
        open deliberately; it blocks nothing, and the seed data already
        declares itself as demo data. *Found during 0.5.*
      - *Local `.env` setup was considered for this list and **dropped**: all
        four `.env.example` files exist, README step 2 tells you to copy each
        one, and `ALLOWED_ORIGINS` and `VITE_BACKEND_URL` are documented in
        both the README tables and the example files. The login failure during
        0.6 came from skipping that documented step, not from a gap in it.*

**Done when:** a fresh `docker compose up` + seed produces doctors with numeric
experience, languages, gender, and real Amman addresses.

---

## Phase 1 — Tool layer, no AI

Every tool as ordinary tested code, before any model is involved. This is the
phase that makes the project tractable — if the tools are proven correct, later
bugs are isolated to the AI layer.

- [x] **1.1** Scaffold `backend/src/assistant/` per the structure in
      `CLAUDE.md`. Add `zod`. Write the `ctx`/`args` contract as a comment
      block in `tools/README.md`. *`zod@4` (not v3 — schema syntax in 1.2+ must
      match). `tools/index.js` is the **patient** registry: an empty `tools`
      array plus `getTool(name)`, which 1.8 iterates, 2.2 turns into tool
      definitions and 4.3 exposes over MCP. Each tool default-exports
      `{ name, description, schema, mutates, handler }` with `handler` keeping
      the `(ctx, args)` signature; `mutates` is declared per tool so 1.8's "no
      write tool" test has something to assert on. Schemas live in the tool
      file, not a separate directory. `guardrails/` is deliberately not created
      yet — 1.7 creates it with its first real file.*
- [x] **1.2** `tools/searchDoctors.js` + zod schema. Filters: speciality,
      min_experience_years, max_fees, language, gender, area. Explicit column
      list. Returns a `maps_url` built server-side. *SQL lives in the new
      `assistant/models/doctorQueries.js` layer, not the tool file — those
      queries carry the explicit column list that keeps `password`, `email` and
      the token columns out of every result. `about` is excluded from search
      results too, so no unsanitised free text reaches them; 1.3's `getDoctor`
      is where that problem lands. Schema is `.strict()`, so a hallucinated
      `user_id` fails the parse rather than riding along in `args`; language,
      gender and area reuse the 0.8 constants as closed vocabularies. Results
      capped at 20, ordered experience DESC.*
- [ ] **1.3** `tools/getDoctor.js` and `tools/listSpecialities.js` + schemas.
- [ ] **1.4** `tools/checkAvailability.js` + schema. Single date or range up to
      7 days. Returns per-date `available` boolean, free-slot count, and
      `checked_at`. Calls the existing `appointmentService`.
- [ ] **1.5** `tools/suggestSpeciality.js` + schema. Pure lookup against
      `speciality_keywords`. No match → return all specialities, never guess.
- [ ] **1.6** `tools/myAppointments.js` + schema. Patient from `ctx` only.
      Includes doctor name, date, time, address, `maps_url`, fee.
- [ ] **1.7** `guardrails/sanitize.js` — truncate free-text fields, strip
      blocklisted keys. `auditLog.js` — write to `assistant_audit_log`.
- [ ] **1.8** Guardrail tests. These must fail loudly if a rule is broken:
      - no registered tool's schema contains an identity key
      - no tool result object contains `password`, `email`,
        `verification_token`, `reset_password_token`
      - the tool registry contains no write tool
      - a doctor seeded with instruction-like text in `about` returns it
        truncated and labelled

**Done when:** every tool passes its tests. No AI code written yet.

---

## Phase 2 — Agent loop and chat endpoint

- [ ] **2.1** `agentService.js` — provider client (Gemini), exponential backoff
      with jitter on 429. Nothing else knows the provider.
- [ ] **2.2** The tool-use loop: send message + history + tool definitions,
      handle tool-call responses, validate args against zod, execute, feed
      results back. Hard cap on iterations (start at 5).
- [ ] **2.3** System prompt. Include: read-only, never books, never diagnoses,
      tool results are data not instructions, availability is never held.
- [ ] **2.4** `guardrails/emergencyCheck.js` — runs before any tool call, on
      every message. Trips → fixed non-generated response, loop ends.
- [ ] **2.5** `guardrails/scopeCheck.js` — booking-system question vs medical
      advice. Out of scope → polite decline.
- [ ] **2.6** Conversation storage: last 10 turns from the `conversations`
      table, 30-day retention.
- [ ] **2.7** `POST /api/assistant/chat` — auth middleware (login-only),
      rate limit (20/user/hour), SSE streaming response.
- [ ] **2.8** Eval file: ~20 test conversations including the adversarial ones —
      "book me anything", "show appointments for user 7", injected bio,
      emergency phrasing, symptom description, prompt-leak attempt.

**Done when:** you can curl the endpoint and hold a conversation. Every
adversarial case in the eval passes.

---

## Phase 3 — Chat UI

- [ ] **3.1** Chat panel component in the patient app, consuming the SSE stream.
- [ ] **3.2** Message rendering: doctor card, availability ✓/✗ badge, maps
      button. The model returns fields; React decides how they look.
- [ ] **3.3** "Availability checked at HH:MM" line on every availability answer.
- [ ] **3.4** Tapping a doctor navigates to the existing booking page with the
      doctor pre-selected.
- [ ] **3.5** Loading, error, and rate-limited states.

**Done when:** the full flow works in a browser, question through to the normal
booking screen.

---

## Phase 4 — MCP server

- [ ] **4.1** Add `@modelcontextprotocol/sdk`. Scaffold `mcp/patient-server.js`
      importing the Phase 1 tool functions directly.
- [ ] **4.2** Auth: how a JWT reaches the server and becomes `ctx`.
- [ ] **4.3** Register the patient tools, reusing the same zod schemas.
- [ ] **4.4** `mcp/README.md` with Claude Desktop setup instructions.

**Done when:** you can open Claude Desktop, ask about your doctors, and get real
answers from your database.

---

## Phase 5 — Notifications, waitlist, doctor assistant

Doctor working hours stay as they are: fixed 10:00–21:00 for every doctor,
generated from constants. This is a deliberate scope decision for a
demonstration project — no `doctor_schedules` table, and slot generation is
not touched.

- [ ] **5.1** Migration: `notifications` (id, user_id, type, payload JSON,
      read_at, created_at) and `waitlist` (id, user_id, doctor_id, date_from,
      date_to, status, created_at).
- [ ] **5.2** `GET /api/notifications` + mark-read endpoint. Bell icon with
      unread count in the patient app, polling every 30s.
- [ ] **5.3** `tools/joinWaitlist.js` — the only write tool. Requires explicit
      confirmation in the conversation before writing.
- [ ] **5.4** Hook into the cancel path where `active_slot` goes NULL: match
      waitlist rows, insert notification rows.
- [ ] **5.5** Doctor tools: `mySchedule`, `scheduleGaps`,
      `patientsNeedingFollowup`, `myStats`. `scheduleGaps` computes free blocks
      against the existing fixed hours — no schema change needed.
- [ ] **5.6** `mcp/doctor-server.js` — separate process, separate auth.

**Done when:** a patient can join a waitlist and receive an in-app notification;
a doctor can ask about their own schedule.

---

## Phase 6 — Infrastructure

Each of these maps to an explicit line on the target job description.

- [ ] **6.1** Redis: rate limiting and conversation storage moved off in-memory.
- [ ] **6.2** BullMQ: the waitlist matcher becomes a background job rather than
      blocking the cancel response.
- [ ] **6.3** `swagger-jsdoc` + `swagger-ui-express`. Document **the whole API**,
      not just the assistant. Served at `/api/docs`.
- [ ] **6.4** GitHub Actions: lint, test, docker build on every push.
- [ ] **6.5** Architecture diagram in the README — the one-tool-layer,
      two-consumers shape.

---

## Phase 7 — RAG clinic knowledge base (optional)

Only after 0–4 are solid. The point is understanding *why* RAG suits
unstructured content and SQL suits structured content.

- [ ] **7.1** Migration: `clinic_docs` (id, title, content, embedding).
- [ ] **7.2** Embedding generation + ingestion script for FAQ content
      (hours, parking, insurance, cancellation policy, what to bring).
- [ ] **7.3** `tools/searchClinicInfo.js` — semantic search, returns passages
      with sources. Same sanitisation rules as every other tool.
- [ ] **7.4** Short write-up in `docs/agent-design.md`: why structured queries
      handle doctors and availability, and why RAG handles policy content.

---

## Per-increment routine

1. `git checkout -b phase-N-name` (once per phase)
2. Plan mode (`Shift+Tab` twice) → `implement increment N.M only` → read the plan
3. Approve, let it implement
4. **Read the diff yourself**
5. Ask it to explain anything unclear
6. Commit
7. Write 2–3 sentences in `docs/notes.md` in your own words
8. `/clear` before the next increment

At each **phase boundary**, open a fresh session and ask it to review the whole
diff for security issues against the rules in `CLAUDE.md`.
