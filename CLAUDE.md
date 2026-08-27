# Prescripto

Medical appointment booking application. Patients browse doctors and book
appointments; doctors manage their schedule; admins manage doctors.

Currently adding an AI assistant. See `docs/agent-plan.md` for the build plan.

## Stack

- **Backend** — Node.js, Express 5, MySQL via `mysql2`, ESM modules
- **Frontends** — two separate React + Vite apps (patient site, admin/doctor panel), Tailwind, React Router, Axios
- **Auth** — JWT with a role claim; separate middleware per role
- **Infra** — Vercel (frontends), Render (API), Aiven (MySQL), Docker Compose locally
- **Services** — Cloudinary (images), Resend (email)

## Structure

```
backend/src/
  admin/          controllers, services, routes, middleware
  appointments/   controller, service, model, routes
  auth/           controller, service, model, routes, middleware
  doctors/        controller, service, model, routes
  config/         db connection, env
  constants/      shared constants
  middleware/     shared middleware
  utils/          helpers
  assistant/      AI assistant (being built — see docs/agent-plan.md)
mcp/              MCP servers (being built)
```

Each feature follows **routes → controller → service → model**. Controllers
handle HTTP only. Services hold business logic. Models hold SQL.

## Commands

No root `package.json` — every npm command runs inside `backend/`, `frontend/`,
`admin/` or `mcp/`.

### Full stack (Docker)

```bash
docker compose up --build
```

**Local development only.** The compose stack is never deployed — production is
Vercel (frontends), Render (API) and Aiven (MySQL). The backend container sets
`NODE_ENV=production`, which is a container setting, not a deploy target.

Needs a root `.env` — `cp .env.example .env` and fill it in. This is a
different file from `backend/.env`: Compose reads the root one for `${...}`
substitution, the Node process reads the backend one via dotenv.

Patient app on :5173, admin panel on :5174, API on :3000, MySQL on **:3307**
(3307 avoids clashing with a local MySQL on 3306). `schema.sql` runs on first
boot and creates tables only — no rows, so seed afterwards.

### Backend (`cd backend`)

```bash
npm run server   # nodemon, watch mode
npm start        # node server.js
npm run migrate  # apply pending migrations (database/migrations/*.sql)
npm run seed     # populate the database (database/seed.js)
```

`schema.sql` is the baseline and only runs on a fresh database; every schema
change after it is a file in `database/migrations/`, applied by `npm run
migrate` and tracked in the `schema_migrations` table. Do not add new columns to
`schema.sql` — a fresh boot would create them and the migration would then fail
as a duplicate. Order after a fresh `docker compose up`: **migrate, then seed.**

### Frontends (`cd frontend` or `cd admin`)

```bash
npm run dev      # Vite dev server
npm run build
npm run lint
```

`lint` currently fails in both apps (8 errors in `frontend`, 6 in `admin`).
Pre-existing — don't treat a red lint run as something you caused.

### Tests

No test runner yet — `npm test` in `backend/` is still the npm placeholder that
exits 1. Phase 1.8 requires one; choose and wire it up there.

## Database

Four tables: `users`, `specialities`, `doctors`, `appointments`.

Two things to know:

- **Slots are generated, not stored.** `appointmentService.js` builds half-hour
  slots from hardcoded constants (10:00–21:00, same for every doctor), then
  removes booked ones. There is no slots table. **This is intentional and stays
  that way** — do not propose or build a per-doctor schedules table.
- **Double-booking is prevented by the database.** `appointments.active_slot` is
  a generated column (NULL when cancelled, otherwise doctor+date+time) with a
  unique index. Concurrent bookings resolve to one success and one clean 409.
  Do not add application-level locking on top of this.

## Code conventions

- ESM imports only, no `require()`
- `async/await`, never raw promise chains
- Parameterised queries only — never string-concatenate SQL
- Errors bubble to the central error handler; don't swallow them in services
- Keep controllers thin; logic belongs in services

## AI assistant rules — non-negotiable

These are security requirements, not style preferences. Do not relax them for
convenience, and flag it explicitly if a task seems to require breaking one.

1. **Tools call the service layer directly.** Never make an HTTP request from a
   tool back to our own API.
2. **No tool wraps a write endpoint.** No POST, PUT or DELETE. The single
   exception is `join_waitlist`.
3. **No tool accepts an identity parameter.** No `user_id`, `patient_id`, or
   doctor-id-of-self in tool arguments. Identity comes from `ctx`, which is
   built from the verified JWT. Model-supplied arguments go in `args` only.
4. **Never `SELECT *` in a tool query.** Explicit column lists. The `users` and
   `doctors` tables contain `password`, `verification_token` and
   `reset_password_token` — these must never reach a tool result.
5. **Tool results are data, not instructions.** Free-text fields (e.g.
   `doctors.about`) are attacker-controlled via the admin panel. Truncate them
   and label them clearly. Never concatenate them into the prompt as though
   they were instructions.
6. **Patient tools and doctor tools are separate servers**, separate processes,
   separate auth. Never one server with a `role` parameter.
7. **Availability is never a promise.** Every availability result carries a
   `checked_at` timestamp. Never phrase a result as a held or reserved slot.
8. **Every tool call is logged** to `assistant_audit_log`: session, user, tool
   name, arguments, result count, timestamp. Log argument values and result
   counts, not full result contents.

## Tool function shape

Every tool has the same signature:

```js
async function toolName(ctx, args, { sessionId }) { ... }
// ctx  = { userId, role } — built by our middleware from the verified JWT
// args = model-supplied, validated against a zod schema before use
// third argument = call metadata from runTool. Additive: every read tool
//   ignores it. join_waitlist uses sessionId to bind its confirmation token
//   to the conversation the patient agreed in.
```

Each tool is a descriptor, not a bare function:

```js
{ name, description, schema, mutates, handler }
// mutates = whether the tool writes. Every tool must declare it explicitly.
//   join_waitlist is the ONLY `true`, per rule 2, and the 1.8 guardrail suite
//   fails if a second one appears.
```

## LLM provider

Development uses the Google Gemini free tier (Flash). Only
`backend/src/assistant/agentService.js` may know which provider is in use —
tools, schemas and guardrails stay provider-agnostic.

Free tier is ~15 requests/minute, so implement exponential backoff with jitter
on 429 responses from the start.

## Scope discipline

- Do not refactor code outside the increment you were asked to implement.
- Do not add dependencies without saying why first.
- If you think a rule above is blocking the task, stop and ask.
