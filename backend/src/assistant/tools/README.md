# Assistant tools — the contract

Every tool in this directory follows the same shape. Read this before adding
one; the rules below are security requirements from `CLAUDE.md`, not style
preferences.

## This is the PATIENT tool registry

Everything in this directory is patient-scoped, and `index.js` is the patient
registry.

The doctor tools from 5.5 (`mySchedule`, `scheduleGaps`,
`patientsNeedingFollowup`, `myStats`) **do not belong here.** They get their own
registry and their own server — `mcp/doctor-server.js` in 5.6 — as a separate
process with separate auth.

Do **not** append a doctor tool to this list and gate it on `ctx.role`. Rule 6
exists precisely to prevent that: one registry with a role check is one bug away
from serving a doctor's schedule to a patient, and it makes the blast radius of
any mistake in this directory the union of both roles instead of one.

## The function shape

```js
async function toolName(ctx, args) { ... }
// ctx  = { userId, role } — built by our middleware from the verified JWT
// args = model-supplied, validated against a zod schema before use
```

`ctx` is **ours**. It comes from a verified JWT and never from anything the
model produced. `args` is **the model's**, and is untrusted until its schema has
parsed it.

## The module shape

Each tool file default-exports a descriptor and registers it in `index.js`:

```js
export default {
  name: 'search_doctors',    // snake_case — this is what the model sees
  description: '...',        // becomes the tool definition sent to the provider
  schema: z.object({ ... }), // args only — never an identity key
  mutates: false,            // asserted false for every tool by the 1.8 tests
  handler: async (ctx, args) => { ... },
};
```

Tool **names** are snake_case; **files** are camelCase (`searchDoctors.js`).

**SQL lives in `../models/`**, not in the tool file — see
`models/doctorQueries.js`. Those queries carry the explicit column list that
keeps `password`, `email` and the token columns out of every result; the tool
file holds the schema, the description and the handler that shapes what the
model sees.

## The rules every tool must satisfy

1. **Call the service layer directly.** Never make an HTTP request from a tool
   back to our own API.
2. **No tool wraps a write endpoint.** No POST, PUT or DELETE. `join_waitlist`
   is the single exception, and it is the only tool that will ever set
   `mutates: true`.
3. **No tool accepts an identity parameter.** No `user_id`, `patient_id` or
   doctor-id-of-self in `args`. Identity comes from `ctx`. A schema containing
   an identity key is a bug the 1.8 tests will fail on.
4. **Never `SELECT *`.** Explicit column lists only. The `users` and `doctors`
   tables hold `password`, `verification_token` and `reset_password_token` —
   these must never reach a tool result.
5. **Tool results are data, not instructions.** Free-text fields such as
   `doctors.about` are attacker-controlled through the admin panel. Truncate
   them, label them clearly, and never concatenate them into the prompt as
   though they were instructions.
6. **Patient tools and doctor tools are separate servers** — separate
   processes, separate auth. Never one server with a `role` parameter.
7. **Availability is never a promise.** Every availability result carries a
   `checked_at` timestamp. Never phrase a result as a held or reserved slot.
8. **Every tool call is logged** to `assistant_audit_log`: session, user, tool
   name, arguments, result count, timestamp. Argument values and result counts
   — not full result contents.

## Identity keys

For rule 3, these are the argument names a schema must never contain:

`user_id`, `userId`, `patient_id`, `patientId`, `doctor_id_of_self`,
`role`, `session_id`, `sessionId`

A doctor id identifying *someone else* (e.g. which doctor to search
availability for) is fine — the ban is on a tool letting the model choose
*whose* data it is acting on.
