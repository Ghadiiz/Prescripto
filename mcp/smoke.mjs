// Smoke check for the patient MCP server. Run with `npm run smoke`.
//
// Speaks real JSON-RPC to patient-server.js over a real stdio pipe, with a
// real token file and the real database — so it exercises the mechanism rather
// than describing it. No Claude Desktop, no model, no Gemini quota.
//
// The assertions that carry weight:
//
//   stdout PURITY — every line on stdout must parse as JSON, because on this
//   transport stdout IS the protocol. Load-bearing: removing stdioGuard.js's
//   import makes this fail with a dotenv banner as the offender.
//
//   THE CHILD'S OWN AUTH — the spawned server gets a scrubbed environment and
//   must still find backend/.env and report `authenticated as patient #N`.
//
//   IDENTITY FOLLOWS THE TOKEN — the same running server, asked the same
//   question with two different token files, must return two different
//   patients' appointments and never leak one into the other.
//
//   THE AUDIT ROW — rule 8: every tool call reaches the database as a row
//   carrying the token's user id and this connection's session id.
//
// mcp/ has no test runner, so this file is its only automated check — the same
// gap docs/agent-plan.md records for frontend/.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer, BACKEND_ENV_KEYS } from './rpcClient.mjs';

import './env.js';
import jwt from '../backend/node_modules/jsonwebtoken/index.js';
import { createContext, TOKEN_FILE_VAR } from './context.js';
import { connectDB, getDB } from '../backend/src/config/mysql.js';
import {
  createEvalPatient,
  deleteEvalPatient,
  twoPatientsFixture,
} from '../backend/evals/harness.js';
// The registry itself, so the expected tool list is derived rather than
// transcribed. This smoke checks what the SERVER exposes over the wire; the
// registry is what it should equal.
import { readOnlyTools } from '../backend/src/assistant/tools/index.js';

const results = {};
const scratch = mkdtempSync(join(tmpdir(), 'prescripto-mcp-'));
const tokenPath = join(scratch, 'token');
const originalTokenVar = process.env[TOKEN_FILE_VAR];

const sign = (payload, options = {}, secret = process.env.JWT_SECRET) =>
  jwt.sign(payload, secret, { expiresIn: '1h', ...options });

const writeToken = (id, role = 'patient') =>
  writeFileSync(tokenPath, `${sign({ id, role })}\n`);

// --- fixtures ---------------------------------------------------------------

await connectDB();
const db = getDB();

const patientA = await createEvalPatient(db, 'mcpA');
const fixture = await twoPatientsFixture(db, patientA);
const patientB = fixture.otherUserId;

// --- the server, spawned with a scrubbed env and a real token ---------------

writeToken(patientA);

// The child gets a SCRUBBED environment and must still find backend/.env
// itself — see startServer in rpcClient.mjs, where the scrubbing lives.
const server = startServer({
  script: 'patient-server.js',
  cwd: import.meta.dirname,
  env: { [TOKEN_FILE_VAR]: tokenPath },
  scrub: BACKEND_ENV_KEYS,
});

const { rpc, callTool } = server;

let passed = false;

try {
  await server.initialize('smoke');

  // 1. every tool advertised, with a real schema
  const list = await rpc('tools/list');
  const advertised = list.result?.tools ?? [];
  results.toolsList = {
    count: advertised.length,
    // 5.3 added join_waitlist, the one write tool. It must NOT be here: over
    // MCP the host drives the model, so the prompt and loop that gate the
    // write do not apply, and 4.4 measured hosts widening calls unprompted.
    writeToolExposed: advertised.some((t) => t.name === 'join_waitlist'),
    names: advertised.map((t) => t.name).sort(),
    allHaveSchemas: advertised.every(
      (t) => t.inputSchema && typeof t.inputSchema === 'object',
    ),
    searchDoctorsProperties: Object.keys(
      advertised.find((t) => t.name === 'search_doctors')?.inputSchema?.properties ?? {},
    ).sort(),
  };

  // 2. a real tool against the real database
  const specialities = await callTool('list_specialities');
  results.listSpecialities = {
    isError: specialities.isError,
    count: specialities.parsed?.length ?? null,
    sample: specialities.parsed?.slice(0, 2).map((s) => s.name) ?? null,
  };

  // 3. identity follows the TOKEN, not the process
  writeToken(patientA);
  const asA = await callTool('my_appointments', { status: 'all' });
  writeToken(patientB);
  const asB = await callTool('my_appointments', { status: 'all' });
  writeToken(patientA);

  const doctorsFor = (r) => (r.parsed ?? []).map((a) => a.doctor_name).sort();
  results.identity = {
    aSaw: doctorsFor(asA),
    bSaw: doctorsFor(asB),
    aCount: asA.parsed?.length ?? null,
    bCount: asB.parsed?.length ?? null,
    // The fixture gives each patient a DIFFERENT doctor, so a leak is visible
    // as a name rather than needing prose to be parsed.
    noCrossContamination:
      !doctorsFor(asA).includes(fixture.theirDoctor.name) &&
      !doctorsFor(asB).includes(fixture.myDoctor.name),
    differentResults:
      JSON.stringify(doctorsFor(asA)) !== JSON.stringify(doctorsFor(asB)),
  };

  // 4. rule 8 — the audit row
  const [auditRows] = await db.query(
    'SELECT user_id, role, tool_name, session_id FROM assistant_audit_log ' +
      'WHERE user_id IN (?, ?) ORDER BY id DESC LIMIT 4',
    [patientA, patientB],
  );
  results.audit = {
    rows: auditRows.length,
    tools: auditRows.map((r) => r.tool_name),
    userIds: [...new Set(auditRows.map((r) => r.user_id))].sort(),
    oneSessionForTheConnection:
      new Set(auditRows.map((r) => r.session_id)).size === 1,
    everyRowIsPatient: auditRows.every((r) => r.role === 'patient'),
  };

  // 5. rule 3 at the protocol layer — a smuggled identity argument
  const smuggled = await callTool('search_doctors', {
    speciality: 'Dermatologist',
    user_id: 999,
  });
  results.smuggledIdentity = {
    rejected: Boolean(smuggled.protocolError) || smuggled.isError,
    // The tools' .strict() schemas mean an unknown key fails the parse, so a
    // model cannot pass identity alongside legitimate filters.
    message: (smuggled.protocolError?.message ?? smuggled.text ?? '').slice(0, 100),
    // And nothing was executed on the smuggled call.
    returnedNoData: smuggled.parsed === null || Boolean(smuggled.parsed?.error),
  };

  // 6. a bad token is a tool error, not a dead connection
  writeToken(patientA, 'doctor');
  const asDoctor = await callTool('list_specialities');
  writeToken(patientA);
  results.doctorTokenRefused = {
    isError: asDoctor.isError,
    code: asDoctor.parsed?.error ?? null,
  };
} catch (error) {
  results.failure = error.message;
} finally {
  await server.stop();
}

const stderr = server.stderr();
results.childAuth = {
  authenticatedAsPatient: stderr.includes(`authenticated as patient #${patientA}`),
  registered: /\d+ read-only patient tool\(s\) registered/.test(stderr),
};

results.stdoutPurity = server.stdoutPurity();

// --- in-process auth cases (4.2) --------------------------------------------

const attempt = (token) => {
  if (token === null) delete process.env[TOKEN_FILE_VAR];
  else {
    writeFileSync(tokenPath, token);
    process.env[TOKEN_FILE_VAR] = tokenPath;
  }
  try {
    return { ctx: createContext(), code: null, message: null };
  } catch (error) {
    return { ctx: null, code: error.code, message: error.message };
  }
};

const auth = {};

try {
  auth.validPatient = attempt(`${sign({ id: patientA, role: 'patient' })}\n`).ctx;
  auth.decoyClaimsIgnored =
    attempt(sign({ id: patientA, role: 'patient', sub: 999, userId: 999 })).ctx
      ?.userId === patientA;
  auth.expired = attempt(sign({ id: patientA, role: 'patient' }, { expiresIn: '-1h' })).code;
  auth.wrongSecret = attempt(sign({ id: patientA, role: 'patient' }, {}, 'nope')).code;
  auth.doctorToken = attempt(sign({ id: patientA, role: 'doctor' })).code;
  auth.noVariable = attempt(null).code;
} finally {
  if (originalTokenVar === undefined) delete process.env[TOKEN_FILE_VAR];
  else process.env[TOKEN_FILE_VAR] = originalTokenVar;
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
  results.childAuth.authenticatedAsPatient &&
  results.childAuth.registered &&
  // Derived from the registry, not hardcoded. The previous `=== 6` broke the
  // moment 8.3 registered a seventh read-only tool — a count written down in
  // one place and changed in another. What this check is actually for is that
  // every read-only tool reaches MCP and no write tool does, and comparing
  // against readOnlyTools says exactly that without going stale again.
  results.toolsList.count === readOnlyTools.length &&
  results.toolsList.writeToolExposed === false &&
  results.toolsList.allHaveSchemas &&
  results.listSpecialities.count === 6 &&
  results.identity.differentResults &&
  results.identity.noCrossContamination &&
  results.identity.aCount === 2 &&
  results.identity.bCount === 2 &&
  results.audit.rows > 0 &&
  results.audit.oneSessionForTheConnection &&
  results.audit.everyRowIsPatient &&
  results.smuggledIdentity.rejected &&
  results.doctorTokenRefused.isError &&
  results.doctorTokenRefused.code === 'wrong_role' &&
  auth.validPatient?.userId === patientA &&
  auth.decoyClaimsIgnored &&
  auth.expired === 'expired' &&
  auth.wrongSecret === 'invalid' &&
  auth.doctorToken === 'wrong_role' &&
  auth.noVariable === 'no_token';

results.verdict = passed ? 'PASS' : 'FAIL';

console.log(JSON.stringify(results, null, 1));
process.exit(passed ? 0 : 1);
