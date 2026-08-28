# AI Assistant — Build Plan

Eight phases, each broken into increments. **One increment per Claude Code
session.** Tick boxes as they complete.

Scope decisions already made:
- Assistant is **login-only**. No anonymous access.
- **English only.** No Arabic UI. (`doctors.languages` is still a search filter.)
- Doctors get their own assistant (Phase 5).
- **Doctor hours are fixed** (10:00–21:00, same for all). No `doctor_schedules`
  table; slot generation is not changed.
- Waitlist notifies **in-app**, not by email.
- Provider is **Gemini free tier** during development.

Phases 0–4 alone are a complete, demonstrable project. 5–8 are additive.

---

## Production state (Aiven)

Which migrations have been applied to the **Aiven production database**. Local
and production are migrated separately — `npm run migrate` from a dev machine
hits whatever `backend/.env` points at, which is normally local MySQL.

**All five migrations are applied** — 001–004 on 2026-08-16, 005 on
2026-08-19. The `schema_migrations` ledger on Aiven holds all five rows, so
re-running the runner there is a no-op — and **do not re-apply any of them by
hand**: the `ALTER`/`CREATE` statements would fail on duplicate columns, tables
and keys.

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
- **005_conversations_unique_user_role.sql** — `uniq_user_role (user_id, role)`
  exists on `conversations`, verified with `SHOW INDEXES` (`Non_unique = 0`).
  Applied 2026-08-19 after a fresh backup and a duplicate pre-check; the table
  was empty, so the unique key had nothing to reject. Without it the
  conversation upsert has nothing to match and history fragments silently.

  `conversations` on Aiven is **empty and stays empty until 2.7's endpoint
  writes to it** — as is `assistant_audit_log`, since nothing calls `runTool`
  in production yet. *(Both now receive writes: `main` deploys as of the Phase 4
  merge.)*

- **006_notifications_waitlist.sql** — `waitlist` and `notifications` both
  exist on Aiven. The `unique_active_request` unique key on `waitlist` is
  verified with `SHOW INDEXES` (`Non_unique = 0`) — the constraint 5.3's write
  tool depends on, so a missing one would move duplicate prevention back into
  application code without anything failing loudly. `schema_migrations` now
  holds all six rows.

  Applied 2026-08-24 after a fresh backup. **No duplicate pre-check was
  needed**, unlike 005: both tables are new, so there were no existing rows for
  the unique key or the CHECK to reject on the way in.

  Both tables are **empty and stay empty until 5.2's notification writes and
  5.3's `join_waitlist` ship** — the same position `conversations` and
  `assistant_audit_log` were in before Phase 4 reached `main`.

`npm run seed` must never run against Aiven — it opens with `DELETE FROM` on all
four tables. Since 0.7 this is enforced rather than trusted: `database/seed.js`
refuses to run unless `DB_HOST` is `localhost` or `127.0.0.1`, aborting before
it opens a connection.

---

## Known issues (tracked, not scheduled)

Pre-existing app bugs found while building something else. Logged so they are
not lost; none blocks the current phase.

- **`GET /api/appointments/available-slots` reports past dates as free.**
  `getAvailableSlots` only special-cases *today* — for any earlier date
  `isToday` is false, so it generates the full 10:00–21:00 grid minus bookings
  and returns a whole day of slots for e.g. last week. The HTTP controller does
  not guard it either. **Low priority:** booking a past slot fails other checks,
  and the patient UI only offers the next 7 days, so it is reachable by direct
  API call rather than through the app. The `check_availability` tool guards
  against it independently (`reason: 'date_in_past'`), so the assistant is not
  affected. *Found during 1.4.*

- **No mid-session database reconnect — affects the WHOLE APP, not just the
  assistant.** Every endpoint shares one connection, so this is a general
  availability limitation rather than an assistant-layer detail.

  `config/mysql.js` uses `createConnection` (a single connection, not a pool);
  the retry loop in `connectDB` runs only at startup, mysql2 does not
  auto-reconnect, and `isReady` is set true once and never cleared. If the connection drops while
  running, every query throws until the process restarts **and 0.7's readiness
  gate still reports ready**, so callers get 500s rather than the 503 that
  situation deserves. 0.7 fixed the startup race only. Switching to
  `mysql.createPool` would fix it (a pool replaces dead connections
  transparently); **6.1** is the natural home, since it already reworks this
  layer for Redis. *Found during 1.7.*

- **RESOLVED in 5.6 — `doctorAuthMiddleware` could not tell a misconfigured
  server from a forged token.** It called `jwt.verify(token,
  process.env.JWT_SECRET)` with no check that the secret exists. With `JWT_SECRET` unset, jsonwebtoken throws
  `JsonWebTokenError` — the same class a bad signature produces — so the
  doctor is told "Invalid token" and someone spends an afternoon on the wrong
  problem. Exactly the confusion 4.2 fixed for patients by checking the secret
  BEFORE `jwt.verify` in `verifyPatientToken.js`, with a distinct
  `misconfigured` code that maps to a 500 rather than a 401.

  **Fixed in 5.6**, as predicted: that increment needed a `verifyDoctorToken`
  anyway — the doctor MCP server has no request to read a header from and must
  reach the same answer the HTTP middleware does. The secret is now checked
  before `jwt.verify`, `misconfigured` has no entry in the middleware's status
  map so it falls through to a 500, and two tests pin it: the code is
  `misconfigured` rather than `invalid`, and the response must not mention the
  token. Removing the check fails both. *Found during 5.5, fixed in 5.6.*

  **Still open elsewhere:** `adminAuthMiddleware.js` has the same shape —
  `jwt.verify` with no secret check — and no verifier of its own. Not fixed
  here because no increment needed an admin ctx; the fix is the same three
  lines whenever one does.

- **The `EXPLAIN` test does not pin the model to the query it explains.**
  `waitlistNotifier.test.js`'s test 13 runs its own copy of the waitlist match
  SQL and asserts the planner picks `idx_match`, which proves the index still
  serves that *shape* — not that `waitlistMatchModel.js` still emits it. A
  mutation dropping `status = 'active'` from the model failed the behavioural
  tests (4 and 5), not this one, so correctness is pinned; only the performance
  assertion is loose. Making it exact would mean exporting the SQL string for
  the test to read, which was **deliberately not done** — a query exported
  solely for a test invites callers the model layer did not intend.
  *Found during 5.4.*

- **Over MCP, a malformed tool call produces no audit row.** The SDK's
  `validateToolInput` throws a `ProtocolError` when arguments fail the tool's
  zod schema, *before* the registered handler runs — so `runTool`, and the
  audit row rule 8 requires, never execute. 1.7 deliberately logs rejected
  calls with `args: null` ("either a model error or someone probing"), and that
  record is missing on this transport.

  Accepted rather than worked around, because it matches HTTP: the chat
  endpoint's `.strict()` body schema also returns 400 with no audit row, so
  input rejected before any tool runs is already un-audited on both sides. The
  alternatives were worse — dropping `inputSchema` would leave the model with
  no argument hints, and advertising a permissive schema would make `tools/list`
  lie about what the tools accept. Note that the rejection is itself a
  guardrail: `.strict()` is what stops a smuggled `user_id` reaching a tool.
  *Found during 4.3.*

- **Over MCP the host's model widens tool calls beyond the question asked.**
  Not a defect — behaviour worth recognising before someone reads the audit log
  and suspects the filters are broken.

  Observed against a live Claude Desktop session. Asking for "dermatologists in
  Khalda" produced two calls, not one:

  | tool | arguments | results |
  |---|---|---|
  | `search_doctors` | `{"area":"Khalda","speciality":"Dermatologist"}` | 1 |
  | `search_doctors` | `{"area":"Khalda"}` | 3 |

  and asking about a single doctor produced `get_doctor {"doctor_id":393}` → 1
  alongside `search_doctors {}` → 16, the whole directory. The unfiltered
  full-table call recurs, appearing to precede several narrower ones.

  **The filters are correct.** `assistant_audit_log` shows every call returned
  exactly what its arguments specified — 1 Khalda dermatologist, 3 Khalda
  doctors, 16 doctors overall. Nothing is being ignored or over-fetched by a
  tool; the extra breadth is the host's model choosing to widen.

  **Why this transport and not the web app.** Over MCP the *host* drives the
  model, so 2.3's system prompt and 2.2's agent loop — which constrain how the
  chat endpoint calls tools — do not apply. The server answers what it is
  asked and has no say in what gets asked.

  **Tool descriptions were deliberately left alone.** Tightening them to
  discourage broad calls would be guessing at another model's behaviour, cannot
  suppress it from the server side anyway, and the widening is arguably useful:
  fetching the directory before narrowing gives the host context our own loop
  gets from conversation history. Worth revisiting only if it becomes a
  performance or data-exposure concern — the tools are read-only and every call
  is audited, so neither applies today. *Found during 4.4.*

- **The booking page offers slots for doctors who are not accepting.**
  `Appointment.jsx` never reads `docInfo.available`, and `GET
  /api/doctors/:id` returns a doctor regardless of the flag (unlike `GET
  /api/doctors`, which filters `available = true`). So the full date and time
  picker renders for a doctor the clinic has stopped booking. Reachable today
  by typing the URL, and — before 3.4 handled it — from a `get_doctor` card.

  3.4 stopped the *assistant* inviting it: the card projects `available` and
  offers "View profile" instead of "Book an appointment". The page itself is
  untouched, because it belongs to the booking flow rather than the assistant,
  and the fix is a product decision (hide the picker? show a notice? 404?)
  rather than a mechanical one. *Found during 3.4.*

- **The notification poll's natural-visibility path is unverified.** The bell
  pauses polling while the tab is hidden and resumes on return. The *hidden*
  half was observed for real — 109 seconds hidden produced zero polls — but the
  Browser pane could not be brought to a visible state through the tooling, so
  the resume was verified by overriding `document.hidden` and dispatching
  `visibilitychange` by hand. That exercises the handler (polls then fired at
  +0s and +30s, exactly as designed) but not the browser's own event.

  Low risk — `visibilitychange` is the documented API and the handler is a few
  lines — but worth a glance in a real browser tab when convenient. *Found
  during 5.2.*

- **`frontend/` has no test runner, so UI guarantees rest on discipline.** The
  backend has 129 tests and a mutation-testing habit; the patient app has
  `eslint` and nothing else. That matters most for **rule 7**: the checked-at
  caveat in `AvailabilityCard.jsx` is protected only by the backend test that
  forces `checkedAt` to ship, and by the line being rendered unconditionally so
  no data shape can drop it. Deleting the line is caught by a human reading the
  diff and nothing more. The same applies to the panel's other guarantees —
  cards rendering only allowlisted fields, the launcher hiding when signed out,
  the abort on close.

  **Phase 6 candidate:** wire up Vitest + React Testing Library and port the
  browser checks done by hand in 3.1-3.2 into real tests. Not urgent while the
  UI is small, and deliberately not bolted onto a UI increment. *Found during
  3.2.*

- **The chat panel cannot rehydrate its thread.** 2.6 stores the last 10 turns
  per `(user_id, role)` and 2.7 replays them to the model, but there is no
  endpoint that returns them. So the panel holds messages in React state only:
  reload the page and the thread looks empty while the assistant still
  remembers everything and will answer "the one in Khalda" correctly. The
  visible history and the model's history disagree.

  Closing it means a read-only `GET /api/assistant/history` scoped to
  `ctx.userId` + `ctx.role` — small, but it is backend work with its own auth
  and scoping tests, so it was left out of a UI increment rather than smuggled
  in. A client-side mirror was rejected: it would be a second source of truth
  that drifts from the server after the 10-turn trim or the 30-day purge.
  *Found during 3.1.*

- **Gemini free tier is 20 requests per DAY, per model — not ~15/minute.**
  The quota id is `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limit
  20. The per-minute figure this plan assumed is the *rate* limit; the daily
  cap is what actually bites. One live two-hop conversation costs 3-4 requests,
  so a day allows roughly five conversations per model.

  **Confirmed working model ids** (verified by live call, not from ListModels,
  which advertises unusable ones): `gemini-3.6-flash` (default),
  `gemini-3.5-flash`, `gemini-3.1-flash-lite`. The quota is per model, so
  switching models buys another 20.

  **2.8 and 2.9 both exist because of this.** 2.8 makes the app degrade
  gracefully when the budget runs out (rotation across the three models, plus a
  50-call daily soft-cap). 2.9's eval then has to fit inside what is left: ~20
  conversations at 3-4 requests each is 60-80 requests — more than a single
  day's ceiling even after rotation. Run the security-critical adversarial
  cases (booking attempts, other-patient access, injected bio, emergency
  phrasing, prompt-leak) **live**, spread across the three models; mock the
  routine happy-path cases. Decide before starting 2.9 whether to enable
  billing instead. *Found during 2.2.*

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
- [x] **1.3** `tools/getDoctor.js` and `tools/listSpecialities.js` + schemas.
      *`get_doctor` deliberately does **not** filter on `available` — asking
      about a named doctor should say they exist but aren't taking
      appointments, rather than pretending they don't exist; `search_doctors`
      still hides them. `doctor_id` is not an identity key: it names another
      party, not the caller. `about` is truncated to 500 chars and returned as
      `{ text, truncated, source }` **inline**, so the tool carries rule 5 from
      the moment it exists — 1.7 replaces that block and extends the same
      treatment to the other admin-controlled fields. `maps_url` moved to a
      shared `tools/mapsUrl.js`; 1.2's output verified byte-identical after the
      extraction.*
- [x] **1.4** `tools/checkAvailability.js` + schema. Single date or range up to
      7 days. Returns per-date `available` boolean, free-slot count, and
      `checked_at`. Calls the existing `appointmentService`.
- [x] **1.5** `tools/suggestSpeciality.js` + schema. Pure lookup against
      `speciality_keywords`. No match → return all specialities, never guess.
      *Matching is exact-term plus whole-word phrase containment, done in JS
      against the 55-row table: `my back pain is bad` matches `back pain`,
      while `gutter`, `coldplay` and `molecular` match nothing. Boundaries are
      checked against a token list, not a regex built from table data.*
      - ***Deviation from the plan:** implemented as **return all matching
        keywords**, not longest-wins. `stomach ache` reports both
        `stomach ache` and `stomach`. More candidates suits the never-guess
        contract better than silently discarding a match, and all three
        overlapping pairs in the table currently share a speciality, so it
        cannot produce a wrong route today. 1.8 adds a test that keeps that
        true.*
      - *No match returns all six specialities with a note instructing the
        model to ask rather than choose — without it, a model handed six
        options picks one anyway. Emergency phrasings deliberately match
        nothing here; 2.4 owns those.*
- [x] **1.6** `tools/myAppointments.js` + schema. Patient from `ctx` only.
      Includes doctor name, date, time, address, `maps_url`, fee.
- [x] **1.7** `guardrails/sanitize.js` — truncate free-text fields, strip
      blocklisted keys. `auditLog.js` — write to `assistant_audit_log`.
      *Sanitising **strips as well as truncates**: control characters
      (`\p{Cc}`) kill the newline-then-`SYSTEM:` vector and format characters
      (`\p{Cf}`) kill zero-width and bidi payloads that hide text from whoever
      reviews a doctor in the admin panel. Short fields stay plain strings;
      `about` keeps the `{ text, truncated, source }` envelope retrofitted from
      1.3. `_unverified` is generated by the helper as it processes each field,
      so it can never drift from what was actually sanitised.*
      - ***`runTool` is the only sanctioned way to execute a tool**, so audit
        logging cannot be forgotten by either of its two callers (2.2 and
        4.3). It validates args, runs the handler, writes the audit row, and
        only then returns — the return is gated on the insert succeeding.*
      - ***On audit failure `runTool` THROWS (fail-closed)** rather than
        returning an error object. **2.2 must abort the turn on a thrown
        tool-execution error** and must not feed it to the model as a tool
        result: a returned `{ error }` could be passed along and the loop would
        continue, turning a security failure into a conversational hiccup. A
        throw cannot be mistaken for data.*
      - *Run-then-log is safe only because every tool is read-only. **5.3's
        `join_waitlist` mutates and must log BEFORE it writes**, so `runTool`
        needs a `mutates`-aware branch then.*
      - ***Scope: every admin-controlled free-text field in a tool result, not
        just `about`.** 1.3 sanitises `about` inline and defers the rest. The
        same admin who can write an injection payload into `about` can write
        one into `name`, `degree`, `address_line1`, `address_line2` or `area` —
        all of which `get_doctor` returns raw today, and the first four of
        which `search_doctors` returns too. `sanitize.js` must truncate and
        label all of them, so no raw admin-controlled string reaches a tool
        result unlabelled, and the inline block in `getDoctor.js` is replaced
        by the shared helper.*
- [x] **1.8** Guardrail tests. These must fail loudly if a rule is broken:
      - no registered tool's schema contains an identity key
      - no tool result object contains `password`, `email`,
        `verification_token`, `reset_password_token`
      - the tool registry contains no write tool
      - a doctor seeded with instruction-like text in `about` returns it
        truncated and labelled
      - **no overlapping keyword pair in `speciality_keywords` disagrees.** For
        any two keywords where one contains the other as a whole phrase
        (`stomach ache` / `stomach`, `hair loss` / `hair`, `general checkup` /
        `checkup`), both must map to the same speciality. 1.5 returns **all**
        matching keywords rather than letting the longest win, so a future pair
        whose shorter form points elsewhere would make `suggest_speciality`
        offer a less-specific wrong route alongside the right one. All three
        current pairs agree; this test keeps it that way.
      - *Runner is **`node:test`** (Node 22 built-in) — no dependency added.
        `npm test` is bare `node --test`: `node --test tests/` makes Node
        resolve the directory as a module and throw MODULE_NOT_FOUND.*
      - *The suite **requires a running MySQL** and is **localhost-guarded**
        like `seed.js` — it INSERTs and DELETEs doctors, users and
        appointments, including a doctor carrying injection payloads, so it
        refuses any non-local `DB_HOST` before `connectDB()` is called.
        6.4 will need a MySQL service container.*
      - *Each assertion was **mutation-tested**: the guardrail was broken one
        at a time and the matching test confirmed to fail, then reverted. A
        guardrail test that cannot fail is worse than no test.*

**Done when:** every tool passes its tests. No AI code written yet. — **DONE.**
Six tools, two guardrails, `runTool` as the single audited entry point, and an
8-test suite that fails when a rule is broken.

---

## Phase 2 — Agent loop and chat endpoint

- [x] **2.1** `agentService.js` — provider client (Gemini), exponential backoff
      with jitter on 429. Nothing else knows the provider. *No SDK: plain
      `fetch` (Node 22), so the retry behaviour is ours rather than an SDK's.
      Exposes one `generate({ system, messages, tools, signal })` returning
      `{ text, toolCalls, finishReason, usage }` — verified live that no Gemini
      vocabulary (`candidates`, `parts`, `functionCall`) crosses the boundary.*
      - ***Model id had to be verified, not assumed.** `ListModels` still
        advertises `gemini-2.5-flash`, but `generateContent` rejects it with
        "no longer available to new users" and points at `gemini-3.6-flash`,
        which is now the pinned default. A catalogued model is not necessarily
        a usable one — probe before pinning.*
      - *Retries 429 and 5xx only; 4xx fails fast. Full jitter, `Retry-After`
        honoured and capped at 10s, `AbortSignal` passed through. The key is
        sent as an `x-goog-api-key` header (never a URL parameter) and is
        asserted absent from thrown messages and error objects even when the
        provider echoes it back.*
- [x] **2.2** The tool-use loop: send message + history + tool definitions,
      handle tool-call responses, validate args against zod, execute, feed
      results back. Hard cap on iterations (start at 5). *Every execution goes
      through `runTool`, sequentially, so audit order matches conversation
      order. Returned `{ error }` results are fed back for self-correction; a
      **thrown** audit failure propagates and ends the turn with no
      model-visible text.*
      - ***Gemini rejects zod's JSON Schema.** `toolDefinitions.js` strips
        `$schema` and `additionalProperties` and maps `exclusiveMinimum` to
        `minimum` (+1 on integers, so `doctor_id: 0` is not advertised as
        valid). `enum`, `required`, `minimum`/`maximum` and `description` all
        survive.*
      - ***The model invents argument keys** — observed live sending
        `specialty` (US spelling) and lowercase enum values. `.strict()`
        rejects them and the error is fed back, so invalid arguments are a
        normal path, not an edge case. Rule 3 stays absolute: a smuggled
        `user_id` fails exactly as loudly as a typo.*
      - ***Conversation history must be faithful.** One model response with N
        tool calls appends ONE assistant turn carrying those calls, then N tool
        results — not N empty assistant messages. `agentService` gained the
        matching mapping branch, which it lacked entirely: assistant-with-tool-
        calls was silently flattened to empty text.*
      - ***Provider state is carried opaquely.** Gemini 3.x attaches a
        `thoughtSignature` to each `functionCall` part and rejects the turn if
        it is replayed without one. It travels in a neutral `providerRef` that
        the loop passes through and never interprets.*
- [x] **2.3** System prompt. Include: read-only, never books, never diagnoses,
      tool results are data not instructions, availability is never held.
      *`buildSystemPrompt({ now })` — a builder, not a constant, so the current
      date can be injected. In 2.2 the model called `check_availability` with a
      date over a year in the past because nothing told it what "today" meant;
      1.4's guard caught it, but injecting the date removes the cause.*
      - ***Only server-controlled facts enter the instruction channel**: the
        date and the fixed 10:00–21:00 hours. No patient name or profile data
        — identity already comes from `ctx`. A test passes a name-like
        injection string and asserts the output is byte-identical without it.*
      - ***The prompt does not enumerate the tools**, and a test enforces that.
        Tool definitions already reach the model via `buildToolDefinitions()`;
        restating them would be a second source of truth that drifts.*
      - ***No emergency wording** — 2.4 runs BEFORE any model call and returns
        a fixed response. Putting it here would imply the model is the safety
        net when it deliberately is not.*
      - *Live-verified: declines to book while stating nothing is held,
        declines to diagnose but routes to a speciality, and declines to recite
        its instructions.*
- [x] **2.4** `guardrails/emergencyCheck.js` — runs before any tool call, on
      every message. Trips → fixed non-generated response, loop ends.
      *Checked at the top of `runConversation` against the latest user
      message: zero provider calls, zero tool calls, zero audit rows on trip.
      Verified by stubbing `fetch` to throw if called at all.*
      - ***Two categories, two responses.** Physical emergencies get 911 plus
        the nearest emergency department. Self-harm and suicidal ideation get
        a separate warm, non-counselling message — telling someone in a
        mental-health crisis to visit A&E reads as a brush-off. If both trip,
        **self-harm wins**: its response already names 911, so nothing is
        lost, while the reverse would answer a crisis with the wrong words.*
      - ***The phrase lists are in code, not the database**, and a test
        enforces it (no `mysql`, `models/` or `getDB` in either guardrail
        file). In a table, anyone with admin access could empty it and nothing
        would look broken.*
      - ***Recall-favouring, unlike `speciality_keywords`.** There precision
        matters; here a false negative means a booking assistant answers a
        crisis, while a false positive costs one turn and every response ends
        with a way to continue. Every term carries its plausible inflections —
        including contraction-stripped forms, since `isnt breathing` does not
        contain the token pair `not breathing`.*
      - *A test asserts the crisis response contains **no phone number except
        911**, so nobody can later add an NGO line that goes stale.*
- [x] **2.5** `guardrails/scopeCheck.js` — booking-system question vs medical
      advice. Out of scope → polite decline. *Runs after `emergencyCheck`,
      before any provider call. Same fixed-response, code-only, word-boundary
      design.*
      - ***Precision-favouring — the inverse of 2.4.** A false positive here
        refuses a real booking question and breaks the core function, while a
        false negative just means the model handles it. When in doubt, let it
        pass.*
      - ***The gate leans off-topic, not medical.** 2.3’s prompt already
        refuses to diagnose (verified live), and the no-write architecture
        means it cannot prescribe regardless — so the medical list is thin
        jailbreak insurance only. Off-topic is where the gate earns its place:
        the model *can* answer "who won the world cup" and would spend one of
        20 daily requests doing it.*
      - ***Every entry is a multi-word intent phrase, enforced by a test.** A
        bare `weather` or `write` would reject "a doctor near the weather
        station" and "write down which doctors treat skin problems", both real
        booking questions. `capital of`, `is it serious` and `should i be
        worried` are deliberately excluded for the same reason.*
      - ***The mutation check found a hollow test.** Reversing the gate order
        left the self-harm ordering test passing, because its message never
        tripped the scope gate. It now uses a message that trips both and
        asserts that premise inline, so it cannot rot.*
- [x] **2.6** Conversation storage: last 10 turns from the `conversations`
      table, 30-day retention. *A turn is one user message plus the
      assistant’s final text reply, so 10 turns is at most 20 stored
      messages. History is one continuous conversation per (user_id, role),
      trimmed — the table has no session_id, deliberately, per 0.4.*
      - ***Only human-readable text is stored.** Never the tool-call requests,
        tool results, or providerRef/thoughtSignature plumbing. Beyond size and
        provider-neutrality, replaying a stored tool result would feed back
        **stale availability** — "22 slots free" captured last week,
        presented as current — which is exactly what rule 7 forbids. Not
        storing it makes that structurally impossible.*
      - ***Every query scopes on user_id AND role**, mutation-proven: removing
        `AND role = ?` fails the test. Patient and doctor id spaces overlap,
        so user_id alone would let patient #5 read doctor #5’s history.*
      - ***Migration 005 was required.** 003’s `idx_user` is non-unique, so
        the upsert had nothing to match — every save would insert a new row
        and history would fragment silently. **Applied to Aiven 2026-08-19** —
        see Production state above.*
      - *Retention sweeps on save (no scheduler), and `purgeExpiredConversations`
        is exported for 6.2’s worker. Conversations expire; **audit rows do
        not** — tested both ways.*
      - *Verified live: text-only replay does not trip the thoughtSignature
        requirement, and the model still resolved "the one in Khalda" from it.*
- [x] **2.7** `POST /api/assistant/chat` — the endpoint that wires Phase 2
      together.
      - Auth middleware, login-only. Build `ctx = { userId, role }` ONLY from
        the VERIFIED JWT (signature checked); never from request body/params.
        This `ctx` is the root of the whole identity chain every Phase 1 tool
        depends on.
      - Request lifecycle order: authenticate → build ctx → load conversation
        history (2.6, scoped to `ctx.userId` + `ctx.role`) → `emergencyCheck`
        (2.4) → `scopeCheck` (2.5) → `runConversation` (2.2) → save the turn
        (2.6). Guardrails run BEFORE any model call. Mint the `session_id` here
        and thread it to `runTool` so audit rows are attributed.
      - Per-user rate limit: **5 requests/user/hour**, keyed on `ctx.userId`
        (NOT IP). On limit, return a friendly 429-style message, not a raw
        error. In-memory is fine (resets on restart; harmless).
      - SSE streaming response. This requires a NEW streaming path in
        `agentService.generate` (Gemini `streamGenerateContent`) that stays
        provider-neutral — the endpoint streams neutral chunks, never Gemini's
        raw stream shape. Streaming must fail gracefully: a mid-stream provider
        error sends a clean SSE error event and closes the connection, never
        leaves the client hanging.
      - **Done when:** an authenticated user can hold a streamed conversation
        end to end; guardrails fire before the model; unauthenticated requests
        are rejected; `ctx` comes only from the verified JWT.
- [x] **2.8** Free-tier budget management (in `agentService`) — keep the demo
      reliable under a reviewer without lag or unpredictable failure.
      - Model rotation: rotate `gemini-3.6-flash` → `gemini-3.5-flash` →
        `gemini-3.1-flash-lite` on a 429 (daily-quota-exhausted), so the
        assistant degrades gracefully instead of dying when one model's free
        quota is used up. ~60 Gemini calls/day effective.
      - Global daily soft-cap: an in-memory counter of ACTUAL Gemini calls made
        today (not user requests — one user turn is several calls). Trip at 50
        (headroom under the ~60 three-model ceiling), so the app stops itself
        gracefully BEFORE Google hard-429s the last model. In-memory (resets on
        restart; harmless for a demo — a reset just allows a few extra calls
        before the cap re-engages). Reset the daily count at UTC midnight.
      - When the cap is hit (or all three models are exhausted), the endpoint
        returns a fixed, friendly "the assistant is at capacity for today,
        please try again tomorrow" message — never a raw error or a hang.
      - Stays provider-neutral: only `agentService` knows the model ids and
        does the rotation; the endpoint and loop see a neutral "at capacity"
        signal, not Gemini specifics.
      - Note for 6.1: the in-memory counter and per-user limiter should move to
        Redis at scale (shared across instances, survives restart).
      - **Done when:** exhausting one model rotates to the next; hitting 50
        calls returns the friendly capacity message; nothing lags or errors raw
        when the budget is gone.
- [x] **2.9** Eval file: ~20 test conversations including the adversarial ones
      (book me anything, show appointments for user 7, injected bio, emergency
      phrasing, symptom description, prompt-leak). Run the security-critical
      adversarial cases LIVE across the three working models; mock the routine
      functional cases (they've been proven live already) to fit the ~20/day
      quota. Done when the endpoint holds a conversation and every adversarial
      case passes.

**Done when:** you can curl the endpoint and hold a streamed conversation, the
assistant degrades gracefully when the free-tier budget runs out, and every
adversarial case in the 2.9 eval passes. — **DONE.**
An SSE endpoint whose `ctx` comes only from the verified JWT, model rotation
with a 50-call daily cap behind a friendly at-capacity message, and a 22-case
eval split 12 mocked (in CI, free) / 10 live (10/10 at 14 Gemini calls). The
eval's own assertions are mutation-tested: 16/16 violations caught, 4/4 honest
replies pass.

---

## Phase 3 — Chat UI

- [x] **3.1** Chat panel component in the patient app, consuming the SSE stream.
- [x] **3.2** Message rendering: doctor card, availability ✓/✗ badge, maps
      button. The model returns fields; React decides how they look.
- [x] **3.3** "Availability checked at HH:MM" line on every availability answer.
      *Built together with 3.2: rule 7 forbids presenting availability as a
      promise, so a ✓ badge shipped without the checked-at line would have put
      a commit in history doing exactly that.*
- [x] **3.4** Tapping a doctor navigates to the existing booking page with the
      doctor pre-selected.
- [x] **3.5** Loading, error, and rate-limited states.

**Done when:** the full flow works in a browser, question through to the normal
booking screen. — **DONE.**
A patient asks in the panel, watches the answer stream in behind labelled
progress, sees doctors and availability as cards rather than markdown, and taps
one through to the existing booking page. Every `stoppedReason` is presented
for what it is — a fixed safety response is not a grey bubble, and an hourly
limit is not the assistant's opinion. Verified in a browser end to end, with
almost all of it driven by stubbed SSE so the free-tier budget went on the
things only a live model can show.

---

## Phase 4 — MCP server

- [x] **4.1** Add the MCP server SDK. Scaffold `mcp/patient-server.js`
      importing the Phase 1 tool functions directly.
      - *Package corrected during 4.1:* the TypeScript SDK has split into
        per-role packages, so this uses **`@modelcontextprotocol/server`
        v2.0.0**, not `@modelcontextprotocol/sdk`. Both are current (published
        the same day from the same repo, neither deprecated), but the footprint
        decides it: the server package pulls **2** dependencies (`zod ^4.2.0`,
        which dedupes onto the 4.4.3 already in use, plus
        `@modelcontextprotocol/core`), against **17** for the combined SDK —
        including `express`, `hono`, `cors`, `express-rate-limit`, `jose` and
        `pkce-challenge`, an HTTP and OAuth stack a stdio server never runs.
      - *`mcp/` is its own npm root*, so CLAUDE.md's npm-roots line now lists
        four directories.
- [x] **4.2** Auth: how a JWT reaches the server and becomes `ctx`.
      - A stdio server has no request to read a header from, so the token comes
        from a file named by `PRESCRIPTO_TOKEN_FILE`, **re-read on every call**
        (patient tokens expire after 7 days; refreshing is one file write, no
        config edit and no restart).
      - Both transports now share one verified root of trust,
        `backend/src/auth/verifyPatientToken.js`, which returns the **ctx
        itself** rather than a decoded payload — so no caller decides what
        identity means. `authMiddleware` only maps its outcomes to statuses.
      - `mcp/env.js` loads `backend/.env` by a path derived from
        `import.meta.url`, because `dotenv.config()` resolves against
        `process.cwd()` and the host chooses the cwd.
- [x] **4.3** Register the patient tools, reusing the same zod schemas.
      - Phase 1's claim held: registration is a plain loop over the existing
        registry — no adapter, no schema conversion, no per-tool special
        casing. `mcp/` and `backend/` have **separate zod instances** (verified
        not identical), but the SDK types against the structural `~standard`
        interface, so the backend's schemas register as-is and emit real JSON
        Schema in `tools/list`.
      - Every call goes through `runTool`, never `tool.handler`, so rule 8's
        audit row is unavoidable. `ctx` is rebuilt **per call** from the token
        file, which is what stops a long-lived server serving one patient's
        data under another's identity — a mutation caching it at startup
        produces exactly that cross-contamination.
      - The database connects lazily on first tool call, so a `connectDB`
        retry window never looks to the host like a server that won't start.
- [x] **4.4** `mcp/README.md` with Claude Desktop setup instructions.
      - Written, then **corrected against a live setup** rather than assumed.
        Three things only the real run could establish: the Microsoft Store
        (MSIX) build sandboxes its config to
        `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\`, so
        the commonly quoted `%APPDATA%\Claude\` path edits a file the app never
        reads — the README now leads with **Settings → Edit Config**, which is
        install-agnostic; closing the window does not reload the config, only a
        **tray quit** does; and Claude Desktop re-prompts for tool permission
        in each new conversation, because "Allow always" is scoped to the
        current chat.

**Done when:** you can open Claude Desktop, ask about your doctors, and get real
answers from your database. — **DONE.**
Verified live against a Microsoft Store install: the six patient tools appear
as `prescripto-patient` and answer from the local database. Phase 1's claim
held — exposing the tools over a second transport was a loop over the existing
registry, not a rewrite. Identity comes from a token file re-read on every
call, so it follows the token rather than the process; every call still goes
through `runTool`, so rule 8's audit row is unavoidable on this transport too.

---

## Phase 5 — Notifications, waitlist, doctor assistant

Doctor working hours stay as they are: fixed 10:00–21:00 for every doctor,
generated from constants. This is a deliberate scope decision for a
demonstration project — no `doctor_schedules` table, and slot generation is
not touched.

- [x] **5.1** Migration: `notifications` (id, user_id, type, payload JSON,
      read_at, created_at) and `waitlist` (id, user_id, doctor_id, date_from,
      date_to, status, created_at).
      - **Duplicates are a database guarantee, not tool logic.** `waitlist`
        copies `appointments.active_slot`: a generated column that goes NULL
        when `status = 'cancelled'`, plus a unique index. So 5.3's write tool
        gets `ER_DUP_ENTRY` on a repeat join instead of needing a read-then-
        write check with a race in it. `'notified'` still holds the slot —
        only cancelling releases it.
      - `notifications` is **patient-only with a real FK** to `users` and
        CASCADE, unlike the role-carrying `assistant_audit_log` and
        `conversations` (see 003's identity note). Doctor notifications would
        be a migration; referential integrity today was worth more than an
        unused column.
      - Also: `CHECK (date_to >= date_from)`, `idx_match` for 5.4's
        cancellation lookup, and `read_at NULL` as the unread marker.
      - Every constraint mutation-tested against the live schema. One could not
        be broken at all: `idx_unread` is refused with `ER_DROP_INDEX_FK`
        because the FK depends on it — protected by construction.
      - **Migration 006 is applied on Aiven** (2026-08-24) — see Production
        state above.
- [x] **5.2** `GET /api/notifications` + mark-read endpoint. Bell icon with
      unread count in the patient app, polling every 30s.
      - **Ownership lives in the WHERE clause**, not in a check the caller
        performs first: `UPDATE … WHERE id = ? AND user_id = ? AND read_at IS
        NULL`. No gap between check and write, no code path where the
        comparison could be forgotten, and no existence leak — a wrong id,
        another patient's id and an already-read one all return the same 200
        with the caller's own unread count, where a 404-vs-403 split would
        confirm which ids exist.
      - Four endpoints, all patient-only. The 30s timer hits a **count-only**
        endpoint (a count over `idx_unread`); the list is fetched when the bell
        is opened, not 2,880 times a day per tab. Polling also pauses while the
        tab is hidden.
      - The model never selects `user_id` — a column that never ships cannot
        leak.
- [x] **5.3** `tools/joinWaitlist.js` — the only write tool. Requires explicit
      confirmation in the conversation before writing.
      - **The confirmation is structural, not prompted.** A first call writes
        nothing and returns a single-use token bound to the session, the
        patient (`ctx.userId`), and the exact arguments, expiring in 10
        minutes. Only a second call carrying a matching token writes, so a
        single call can never write whatever the model decides.
        - *Honest limit, recorded in `confirmations.js`:* this guarantees two
          phases, **not** that a human was asked — the server cannot see the
          patient. The system prompt and agent loop are what turn the gap into
          a real question, which is exactly why the tool is **not exposed over
          MCP**, where the host drives the model.
      - `user_id` is written from `ctx`, never from arguments; the `.strict()`
        schema rejects a smuggled one before the handler runs.
      - Duplicates stay a **database** guarantee: 006's `unique_active_request`
        yields `ER_DUP_ENTRY`, reported as `already_waiting` rather than raced
        against with a pre-check.
      - **`runTool` now logs BEFORE a write** and fills in the outcome after,
        as its own comment had required since 1.7. A crash mid-write leaves a
        row with `result_count: null` — "attempted, outcome unknown" — instead
        of a change with no audit trail.
      - Two guardrails changed **deliberately**, both getting stronger: the 1.8
        rule-2 test now names `join_waitlist` as the sole permitted write
        (a second one fails), and the system prompt's blanket "you can only
        read information" became the specific commitment that still holds.
- [x] **5.4** Hook into the cancel path where `active_slot` goes NULL: match
      waitlist rows, insert notification rows.
      - **There are two cancel paths, not one.** The patient's service and the
        doctor's share no model function, so both are hooked. The mutation that
        removed only the doctor hook still passed 13 of 14 tests — a
        single-path implementation would have looked green, and a doctor
        cancelling is arguably the *more* common reason a slot opens.
      - **A notification failure cannot fail a cancellation.** By the time the
        notifier runs the cancellation has already committed; throwing would
        report failure for something that succeeded and invite a second cancel
        attempt. The cost, stated rather than hidden: that notification is
        **lost**, with a console line as its only trace. Acceptable because the
        waitlist row survives — 6.2's job queue is where this becomes durable.
      - **The waitlist row stays `active` after notifying**, so a patient who
        misses this slot still hears about the next one. Dedupe is per freed
        date, not per row: overlapping windows for one patient produce one
        notification, and an unread notice for the same doctor and date is not
        stacked.
      - Matching is scoped to `active` rows whose window covers the freed date,
        excluding the patient who cancelled and any date already past.
- [x] **5.5** Doctor tools: `mySchedule`, `scheduleGaps`,
      `patientsNeedingFollowup`, `myStats`. `scheduleGaps` computes free blocks
      against the existing fixed hours — no schema change needed.
      - **A separate registry, not a role parameter** (rule 6).
        `doctorTools/index.js` is its own list, and `runTool.js` became a
        FACTORY: `createToolRunner(registry, auditIdentity)`, bound once per
        PROCESS. There is no role branch anywhere in the runner, and all ten
        existing importers of `runTool` were unchanged.
      - **A doctor ctx is `{ doctorId, role }`, never `{ userId }`.** A doctor
        JWT's `id` is `doctors.id` — a different id space from `users.id`,
        where patient #7 and doctor #7 are different people. With a distinct
        field, a ctx that reaches the wrong registry returns empty instead of
        returning the wrong person's rows.
        - That is also why the runner takes an identity extractor:
          `assistant_audit_log.user_id` is NOT NULL, and 003's `role` ENUM is
          what tells the two id spaces apart in that column. The mutation
          swapping it back to `ctx.userId` did not merely mislabel the row —
          it made the row **unwritable**, which failed the call. The audit
          write is a precondition of getting data back, not a side effect.
      - **`doctor_id` is an identity key on this side and not on the other.**
        In a patient tool it names another party; in a doctor tool it names the
        caller. The guardrail suite applies a different banned-key list to each
        registry.
      - **Patient names are untrusted text too.** `users.name` is written by
        the patient, so a doctor tool returning it raw would let a patient
        write an instruction into the DOCTOR's assistant. `patient_name` joins
        the same `sanitizeAdminText` list as `doctors.about` — rule 5 with a
        different author, not a different rule.
      - `doctorAppointmentService.getDoctorAppointments` is deliberately NOT
        reused: it is `SELECT a.*` and returns `patientEmail`. Correct for the
        panel, forbidden in a tool result. `my_stats` sums `a.amount`, the fee
        actually charged, rather than joining today's `doctors.fees` onto last
        year's appointments the way `getDoctorDashboard` does.
      - The 10:00-21:00 grid is restated in `doctorTools/hours.js` rather than
        the booking flow being refactored mid-increment (`getAvailableSlots`
        throws when a doctor is not accepting bookings, and returns display
        strings). **The duplication is pinned by a test** asserting the two
        grids agree for a doctor with nothing booked.
      - `join_waitlist` gained the explicit `ctx.role !== 'patient'` guard
        `my_appointments` already had. Decision above already makes a doctor
        ctx fail there structurally; this states it on the one tool that writes.
- [x] **5.6** `mcp/doctor-server.js` — separate process, separate auth.
      - **`verifyDoctorToken` is the doctor half of 4.2**, and writing it is
        what resolved the Known Issue above: `JWT_SECRET` is checked BEFORE
        `jwt.verify`, so a missing secret is `misconfigured` → 500 rather than
        "Invalid token" → 401. It returns the ctx itself — `{ doctorId, role }`
        — so no caller decides which claim means identity.
        - `TokenError` moved to its own module and `verifyPatientToken.js`
          re-exports it; its three existing importers were untouched.
        - The HTTP middleware was rewired onto it. `req.doctor.id` is
          preserved (all eight controller uses read it); **`req.doctor.email`
          is dropped** — grepped, nothing read it, and the verifier returns
          identity only.
      - **A separate token file variable with NO fallback.**
        `PRESCRIPTO_DOCTOR_TOKEN_FILE`, never the patient's. A fallback would
        mean a doctor server quietly reading a patient's credential and failing
        with a confusing `wrong_role` instead of naming the missing setting.
      - **`callTool` became a factory**, exactly as `runTool` did in 5.5: the
        context builder and the runner are bound per PROCESS. The audited
        bridge — call runTool never `tool.handler`, rebuild ctx per call, args
        never reach ctx — stays one implementation. Each binding mints its own
        `sessionId`, so a machine running both servers does not file a doctor's
        calls and a patient's under one id.
      - **The tripwire now points both ways.** 4.3's `assertPatientRegistry`
        refuses a doctor tool; `assertDoctorRegistry` refuses a patient tool
        *and* any `mutates` tool. Both are fatal at startup.
      - *Two honest limits found while verifying:* the named registry
        assertions test the guard's LOGIC, not that the server passes it the
        real registry — that is the smoke's job, so the smoke now prints the
        child's stderr head and names the rule instead of reporting a bare
        timeout. And the doctor smoke's audit assertions were **hollow on
        first writing**: filtered by `role` and `user_id`, then asserting those
        same two facts, and unscoped — a run that wrote no rows at all passed
        on leftovers from an earlier one. Now watermarked, and rows are found
        by tool name so identity is what gets asserted.

**Done when:** a patient can join a waitlist and receive an in-app notification;
a doctor can ask about their own schedule. — **DONE.**
Both servers verified over real stdio pipes with scrubbed child environments
(`npm run smoke` runs each): four doctor tools advertised and no patient tool,
identity following the token file across two doctors with no bleed, audit rows
carrying `role = 'doctor'` and `doctors.id`, and a patient token refused with
`wrong_role`. Rule 6 now holds end to end — separate registries, separate
runners, separate token files, separate processes.

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

## Phase 7 — Time-aware availability and actionable notifications

Enhancements that came out of the Phase 5 live end-to-end test. **None of these
is a bug** — the current behaviour is correct, just less capable. A notification
that says "a slot opened on Aug 30" is true and useful; it is simply not as
useful as one that says "a 10:30 slot opened, click to book it".

The theme is TIME. Phase 5 reasons about availability at the granularity of a
DATE: `check_availability` returns a count per date, the waitlist stores a date
range, and the 5.4 notifier matches on the date a slot frees. Every increment
here pushes some part of that down to the half-hour the booking grid actually
uses.

**Why here, after Phase 6 and before RAG:**

- 7.2's notifier work is cleaner on top of **6.2's durable job queue** than on
  the current fire-and-forget notifier, whose stated cost is that a failed
  notification is simply lost.
- 7.4 changes the 5.1 schema and its unique constraint, which wants **6.4's CI**
  guarding it rather than a migration verified by hand.
- All four refine the core Phase 5 booking and waitlist flow, so they come
  before the optional RAG add-on that adds a different kind of retrieval.

Ordered cheapest-first: the frontend win leads, the schema change goes last.

- [ ] **7.1** **Actionable notification click-through.** Clicking a notification
      navigates to the doctor's booking page with the date pre-filled, instead
      of leaving the patient to find the doctor themselves.
      - Cheapest, highest-value, lowest-risk of the four — and mostly
        FRONTEND. The payload 5.4 writes already carries `doctor_id` and
        `date`, so nothing new has to be stored or matched: the bell routes to
        `/appointment/:docId` with the date preselected.
      - **Check first whether `Appointment.jsx` can accept a pre-selected date**
        via URL param or router state; it may need a small addition.
      - Ties into the **3.4 deferred item** in Known issues — the booking page
        offering slots for doctors who are not accepting. Both touch that page's
        date handling, and a notification is a *stronger* invitation to book
        than the assistant card 3.4 already softened, so the two are worth
        deciding together rather than twice.

- [ ] **7.2** **The freed time, not just the freed date.** The notification says
      only which DATE opened up. The cancelled appointment has a specific
      `appointment_time`, so the notice can say *"a 10:30 slot opened with
      Dr. X on Aug 30"*.
      - Smaller than 7.3 and 7.4: no schema change and no new query. The time is
        already on the row `waitlistNotifier.js` reads — it flows through the
        notifier and into the payload, and the bell renders it.
      - Note the dedupe interaction: 5.4 suppresses a second unread notice for
        the same doctor and DATE. Once a notice names a time, two different
        freed slots on one day are arguably two different pieces of news —
        decide deliberately whether the dedupe key gains the time too, rather
        than letting it follow by accident.
      - Rule 7 still holds: a named time is still a snapshot with a
        `checked_at`, never a held slot.

- [ ] **7.3** **Specific-slot availability answers.** `check_availability`
      returns a free-slot COUNT plus `checked_at`, so the model *cannot* answer
      "is 10am–2pm free?" — it has no per-slot data to reason over. Return the
      actual free/booked times for a date so it can say "10–12 is booked, 12–2
      has openings" and offer the waitlist for that window.
      - The slots already exist: `getAvailableSlots` builds them and 5.5's
        `doctorTools/hours.js` already works in half-hour starts. This is
        mostly about widening what the tool RETURNS.
      - **Times are not PII, but the wider result surface still follows rule 4's
        explicit-column discipline:** return times and availability, never WHO
        booked the other slots. "10:30 is taken" is availability; "10:30 is
        taken by Sara" is a patient's medical appointment.
      - **Cost, weighed honestly:** a per-slot result is far more tokens per
        turn than a count. Against the free tier's ~15 conversations a day that
        is a real budget question, not a rounding error — consider returning
        slots only when the question is time-specific, or a compact
        representation rather than a full list.

- [ ] **7.4** **Time-range waitlist** (schema change — the biggest item, last).
      `join_waitlist` and the `waitlist` table are DATE-range only
      (`date_from`/`date_to`), and 5.4's notifier matches on the date a slot
      frees, not the hour. To support *"waitlist me if 10am–2pm frees up
      specifically"*, the waitlist must carry a TIME window and the matching
      must compare times, not just dates.
      - **This touches 5.1's schema and its unique constraint.**
        `active_request` currently CONCATs `user_id`, `doctor_id`, `date_from`
        and `date_to`; adding time bounds changes the uniqueness key, so
        "already on this list" comes to mean something new. That guarantee is
        currently a DATABASE guarantee — keep it one.
      - **Decide the granularity.** Half-hour, to match the booking grid, is
        the obvious candidate and keeps the notifier comparing like with like.
      - Migration 007, applied to Aiven by hand like every other — see
        Production state. **Wants 6.4's CI**, which is a large part of why this
        phase sits after Phase 6.
      - Interacts with 7.2's dedupe decision and with 7.3's per-slot data: all
        three are the same move to half-hour granularity, seen from the
        notification, the query and the schema.

---

## Phase 8 — RAG clinic knowledge base (optional)

Only after 0–4 are solid. The point is understanding *why* RAG suits
unstructured content and SQL suits structured content.

*Renumbered from Phase 7 when the time-aware phase was inserted above it. It
stays last because it is the one phase that adds a new KIND of retrieval rather
than refining the booking flow — and the only one marked optional.*

- [ ] **8.1** Migration: `clinic_docs` (id, title, content, embedding).
- [ ] **8.2** Embedding generation + ingestion script for FAQ content
      (hours, parking, insurance, cancellation policy, what to bring).
- [ ] **8.3** `tools/searchClinicInfo.js` — semantic search, returns passages
      with sources. Same sanitisation rules as every other tool.
- [ ] **8.4** Short write-up in `docs/agent-design.md`: why structured queries
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
