# Doctor tools — the contract

The companion to `../tools/README.md`. Everything there about descriptor shape,
`ctx` vs `args` and the eight rules applies here too. This file records only
what is **different on the doctor side**, because the differences are the part
that gets forgotten.

## This is the DOCTOR registry

`index.js` here is the doctor registry; `../tools/index.js` is the patient one.
They are separate lists, loaded by separate processes, under separate auth
(rule 6). `mcp/patient-server.js` refuses to boot if a name from this directory
appears in its registry — a tripwire 4.3 left deliberately for 5.5.

Do **not** merge them and switch on `ctx.role`.

## `ctx` is `{ doctorId, role: 'doctor' }` — not `{ userId }`

This is the difference most likely to cause a real leak, so it is structural
rather than remembered.

A doctor JWT's `id` claim is **`doctors.id`**, which is a different id space
from `users.id`. Patient #7 and doctor #7 both exist and are different people.
Had the doctor ctx reused `userId`, a doctor ctx that reached a patient tool
would read patient #7's appointments under doctor #7's identity, silently and
plausibly.

With a distinct field, the same mistake yields `undefined` and returns nothing.
Every tool here calls `requireDoctor(ctx)` first, mirroring the guard in
`../tools/myAppointments.js` from the other side.

## `doctor_id` is an identity key HERE

In a patient tool `doctor_id` names another party — which doctor to search, to
check availability for, to wait on — and is allowed. In a doctor tool it names
**the caller**, so it is exactly the "doctor-id-of-self" rule 3 bans.

`tests/guardrails.test.js` encodes the asymmetry: the identity-key list applied
to this registry includes `doctor_id`, the one applied to the patient registry
does not.

## Patient names are untrusted text

`users.name` is typed by the patient at registration. A doctor tool returning
it raw would let a patient write an instruction into the doctor's assistant —
the rule 5 problem, with a different author from `doctors.about`.

So `patient_name` goes through `sanitizeAdminText` like any other free text and
appears in `_unverified`. It is listed in `guardrails/sanitize.js`, which stays
the single definition of which fields are untrusted; do not filter it here.

**No email, ever** (rule 4), and no `user_id`: the doctor panel is where a
doctor contacts a patient. A tool result is read by a model and, over MCP,
leaves our process.

## SQL

In `../models/doctorScheduleQueries.js`, with `doctor_id = ?` bound first and
never optional.

`doctorAppointmentService.getDoctorAppointments` is **not** reused: it is
`SELECT a.*` and returns `patientEmail`. It is correct for the panel and wrong
for a tool.

## Consulting hours

`hours.js` restates the 10:00–21:00 half-hour grid that
`appointmentService.getAvailableSlots` builds inline, because that function
throws when a doctor is not accepting bookings and returns display strings.
The duplication is pinned by a test asserting the two grids agree — if you
change the hours, change them in both and that test will tell you if you did
not.
