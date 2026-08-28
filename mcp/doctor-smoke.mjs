// Smoke check for the DOCTOR MCP server. Run with `npm run smoke:doctor`.
//
// The analogue of smoke.mjs, over a real stdio pipe with a real token file and
// the real database. No Claude Desktop, no model, no Gemini quota.
//
// The assertions that carry weight — the same four as the patient smoke, plus
// the one this server exists to make:
//
//   stdout PURITY — every line on stdout must parse as JSON.
//
//   THE CHILD'S OWN AUTH — a scrubbed environment, and the server must still
//   find backend/.env and report `authenticated as doctor #N`.
//
//   IDENTITY FOLLOWS THE TOKEN — the same running server, given two different
//   doctors' tokens, must return two different schedules and never leak one
//   into the other.
//
//   THE AUDIT ROW — rule 8, with `role = 'doctor'` and `user_id = doctors.id`.
//
//   RULE 6 — no patient tool is advertised here, and a PATIENT token is
//   refused. This is a different registry reached through different auth, not
//   the same server with a role flag.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import './env.js';
import jwt from '../backend/node_modules/jsonwebtoken/index.js';
import { createDoctorContext, DOCTOR_TOKEN_FILE_VAR } from './doctor-context.js';
import { TOKEN_FILE_VAR } from './context.js';
import { connectDB, getDB } from '../backend/src/config/mysql.js';
import {
  createEvalPatient,
  deleteEvalPatient,
  twoPatientsFixture,
  auditWatermark,
  auditSince,
} from '../backend/evals/harness.js';
import { startServer, BACKEND_ENV_KEYS } from './rpcClient.mjs';

const results = {};
const scratch = mkdtempSync(join(tmpdir(), 'prescripto-mcp-doctor-'));
const tokenPath = join(scratch, 'doctor-token');
const originalTokenVar = process.env[DOCTOR_TOKEN_FILE_VAR];

const sign = (payload, options = {}, secret = process.env.JWT_SECRET) =>
  jwt.sign(payload, secret, { expiresIn: '1h', ...options });

const writeToken = (id, role = 'doctor') =>
  writeFileSync(tokenPath, `${sign({ id, role })}\n`);

// --- fixtures ---------------------------------------------------------------
//
// twoPatientsFixture already books two appointments with one doctor and two
// with another, on fixed 2031 dates. That is exactly the shape this needs: two
// doctors whose schedules must never bleed into each other.

await connectDB();
const db = getDB();

const patientA = await createEvalPatient(db, 'mcpDoc');
const fixture = await twoPatientsFixture(db, patientA);

const doctorA = fixture.myDoctor;
const doctorB = fixture.theirDoctor;

// Taken before the server starts, so the audit assertions below see only the
// rows THIS run produced. Without it they pass on leftovers from a previous
// run — measured: with the doctor runner deliberately broken so it wrote no
// rows at all, an unscoped query still returned three correct-looking rows.
const watermark = await auditWatermark(db);

// --- the server, spawned with a scrubbed env and a real token ---------------

writeToken(doctorA.id);

const server = startServer({
  script: 'doctor-server.js',
  cwd: import.meta.dirname,
  env: {
    [DOCTOR_TOKEN_FILE_VAR]: tokenPath,
    // Deliberately pointed at nothing: the doctor server must not fall back to
    // the patient variable. If it did, this would be the file it read.
    [TOKEN_FILE_VAR]: join(scratch, 'patient-token-that-does-not-exist'),
  },
  scrub: BACKEND_ENV_KEYS,
});

const { rpc, callTool } = server;

let passed = false;

try {
  await server.initialize('doctor-smoke');

  // 1. the four doctor tools, and NOTHING from the patient registry
  const list = await rpc('tools/list');
  const advertised = list.result?.tools ?? [];
  const names = advertised.map((t) => t.name).sort();

  results.toolsList = {
    count: advertised.length,
    names,
    allHaveSchemas: advertised.every(
      (t) => t.inputSchema && typeof t.inputSchema === 'object',
    ),
    // Rule 6 at the protocol layer. A patient tool here would be reachable by
    // a doctor's token.
    patientToolsExposed: names.filter((name) =>
      [
        'search_doctors',
        'get_doctor',
        'list_specialities',
        'check_availability',
        'suggest_speciality',
        'my_appointments',
        'join_waitlist',
      ].includes(name),
    ),
    mySchedulePropertyNames: Object.keys(
      advertised.find((t) => t.name === 'my_schedule')?.inputSchema?.properties ?? {},
    ).sort(),
  };

  // 2. a real tool against the real database
  const stats = await callTool('my_stats', { period: 'all_time' });
  results.myStats = {
    isError: stats.isError,
    appointmentsTotal: stats.parsed?.appointments_total ?? null,
    // The fixture books exactly two appointments with this doctor.
    countsOnlyThisDoctor: stats.parsed?.appointments_total === 2,
  };

  // 3. identity follows the TOKEN, not the process
  writeToken(doctorA.id);
  const asA = await callTool('my_schedule', { date: fixture.myDates[0], days: 7 });
  writeToken(doctorB.id);
  const asB = await callTool('my_schedule', { date: fixture.myDates[0], days: 7 });
  writeToken(doctorA.id);

  const datesWithAppointments = (r) =>
    (r.parsed?.dates ?? [])
      .filter((d) => d.appointment_count > 0)
      .map((d) => d.date)
      .sort();

  results.identity = {
    aSaw: datesWithAppointments(asA),
    bSaw: datesWithAppointments(asB),
    // The fixture gives each doctor DIFFERENT dates, so a leak is visible as a
    // date rather than needing prose to be parsed.
    aSawOnlyTheirOwn:
      JSON.stringify(datesWithAppointments(asA)) ===
      JSON.stringify([...fixture.myDates].sort()),
    bSawOnlyTheirOwn:
      JSON.stringify(datesWithAppointments(asB)) ===
      JSON.stringify([...fixture.theirDates].sort()),
    differentResults:
      JSON.stringify(datesWithAppointments(asA)) !==
      JSON.stringify(datesWithAppointments(asB)),
  };

  // 4. rule 8 — the audit row, filed under the DOCTOR's id
  // Scoped to this run by id watermark, and NOT filtered by role or user_id.
  //
  // Both halves matter. Filtering on `role = 'doctor' AND user_id IN (A, B)`
  // and then asserting those same two things is a tautology. And an unscoped
  // query reads rows an earlier run left behind — measured: with the doctor
  // runner deliberately pointed at the patient registry, so this run wrote
  // nothing, the unscoped version still returned three correct-looking rows
  // and every audit assertion passed.
  const auditRows = await auditSince(db, watermark);
  results.audit = {
    rows: auditRows.length,
    tools: auditRows.map((r) => r.tool_name),
    userIds: [...new Set(auditRows.map((r) => r.user_id))].sort(),
    // The whole point of runDoctorTool's identity extractor: doctors.id, under
    // role 'doctor', in a column shared with users.id.
    everyRowIsDoctor: auditRows.every((r) => r.role === 'doctor'),
    idsAreDoctorIds: auditRows.every((r) =>
      [doctorA.id, doctorB.id].includes(r.user_id),
    ),
    oneSessionForTheConnection:
      new Set(auditRows.map((r) => r.session_id)).size === 1,
  };

  // 5. rule 3 at the protocol layer — a smuggled identity argument.
  // On this side `doctor_id` names the CALLER, so it is the identity key.
  const smuggled = await callTool('my_schedule', {
    date: fixture.myDates[0],
    doctor_id: doctorB.id,
  });
  results.smuggledIdentity = {
    rejected: Boolean(smuggled.protocolError) || smuggled.isError,
    message: (smuggled.protocolError?.message ?? smuggled.text ?? '').slice(0, 100),
    returnedNoData: smuggled.parsed === null || Boolean(smuggled.parsed?.error),
  };

  // 6. a PATIENT token is a tool error, not a dead connection
  writeToken(patientA, 'patient');
  const asPatient = await callTool('my_stats');
  writeToken(doctorA.id);
  results.patientTokenRefused = {
    isError: asPatient.isError,
    code: asPatient.parsed?.error ?? null,
  };
} catch (error) {
  results.failure = error.message;

  // A server that refuses to start shows up here as "timed out waiting for
  // initialize", which is true and useless. The reason is on the child's
  // stderr — assertDoctorRegistry's rule 6 message, most likely — so surface
  // it rather than making the next person go looking.
  // The HEAD, not the tail: `console.error('Failed to start:', error)` prints
  // the message first and a Node module-loader stack after it, so the last
  // lines are the least informative part.
  const stderrSoFar = server.stderr().trim();
  if (stderrSoFar) results.childStderr = stderrSoFar.split('\n').slice(0, 3);
} finally {
  await server.stop();
}

const stderr = server.stderr();
results.childAuth = {
  authenticatedAsDoctor: stderr.includes(`authenticated as doctor #${doctorA.id}`),
  registered: /\d+ read-only doctor tool\(s\) registered/.test(stderr),
};

results.stdoutPurity = server.stdoutPurity();

// --- in-process auth cases ---------------------------------------------------

const attempt = (token, { variable = DOCTOR_TOKEN_FILE_VAR } = {}) => {
  delete process.env[DOCTOR_TOKEN_FILE_VAR];

  if (token !== null) {
    writeFileSync(tokenPath, token);
    process.env[variable] = tokenPath;
  }

  try {
    return { ctx: createDoctorContext(), code: null, message: null };
  } catch (error) {
    return { ctx: null, code: error.code, message: error.message };
  }
};

const auth = {};
const originalPatientVar = process.env[TOKEN_FILE_VAR];

try {
  auth.validDoctor = attempt(`${sign({ id: doctorA.id, role: 'doctor' })}\n`).ctx;
  auth.decoyClaimsIgnored =
    attempt(sign({ id: doctorA.id, role: 'doctor', sub: 999, doctorId: 999 })).ctx
      ?.doctorId === doctorA.id;
  auth.expired = attempt(
    sign({ id: doctorA.id, role: 'doctor' }, { expiresIn: '-1h' }),
  ).code;
  auth.wrongSecret = attempt(
    sign({ id: doctorA.id, role: 'doctor' }, {}, 'nope'),
  ).code;
  auth.patientToken = attempt(sign({ id: patientA, role: 'patient' })).code;
  auth.noVariable = attempt(null).code;

  // The fallback that must not exist: a token written to the file, but named
  // only by the PATIENT variable. The doctor server must not find it.
  auth.ignoresPatientVariable =
    attempt(sign({ id: doctorA.id, role: 'doctor' }), {
      variable: TOKEN_FILE_VAR,
    }).code === 'no_token';
} finally {
  if (originalTokenVar === undefined) delete process.env[DOCTOR_TOKEN_FILE_VAR];
  else process.env[DOCTOR_TOKEN_FILE_VAR] = originalTokenVar;

  if (originalPatientVar === undefined) delete process.env[TOKEN_FILE_VAR];
  else process.env[TOKEN_FILE_VAR] = originalPatientVar;
}

results.auth = auth;

// --- teardown ---------------------------------------------------------------

try {
  await fixture.cleanup();
  await deleteEvalPatient(db, patientA);
} finally {
  rmSync(scratch, { recursive: true, force: true });
  await db.end();
}

passed =
  !results.failure &&
  results.stdoutPurity.verdict === 'CLEAN' &&
  results.childAuth.authenticatedAsDoctor &&
  results.childAuth.registered &&
  results.toolsList.count === 4 &&
  results.toolsList.patientToolsExposed.length === 0 &&
  results.toolsList.allHaveSchemas &&
  results.myStats.countsOnlyThisDoctor &&
  results.identity.differentResults &&
  results.identity.aSawOnlyTheirOwn &&
  results.identity.bSawOnlyTheirOwn &&
  results.audit.rows > 0 &&
  results.audit.everyRowIsDoctor &&
  results.audit.idsAreDoctorIds &&
  results.audit.oneSessionForTheConnection &&
  results.smuggledIdentity.rejected &&
  results.smuggledIdentity.returnedNoData &&
  results.patientTokenRefused.isError &&
  results.patientTokenRefused.code === 'wrong_role' &&
  auth.validDoctor?.doctorId === doctorA.id &&
  auth.decoyClaimsIgnored &&
  auth.expired === 'expired' &&
  auth.wrongSecret === 'invalid' &&
  auth.patientToken === 'wrong_role' &&
  auth.noVariable === 'no_token' &&
  auth.ignoresPatientVariable;

results.verdict = passed ? 'PASS' : 'FAIL';

console.log(JSON.stringify(results, null, 1));

process.exit(passed ? 0 : 1);
