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

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import './env.js';
import jwt from '../backend/node_modules/jsonwebtoken/index.js';
import { createContext, TOKEN_FILE_VAR } from './context.js';
import { connectDB, getDB } from '../backend/src/config/mysql.js';
import {
  createEvalPatient,
  deleteEvalPatient,
  twoPatientsFixture,
} from '../backend/evals/harness.js';

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

// Everything backend/.env supplies is stripped, so the server must find and
// load that file itself. Passing `{...process.env}` would hand it the values
// this process already loaded, and the check would pass even with env.js
// removed — which is exactly what happened the first time it was written.
const childEnv = { ...process.env, [TOKEN_FILE_VAR]: tokenPath };
for (const key of ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
  delete childEnv[key];
}

const child = spawn(process.execPath, ['patient-server.js'], {
  cwd: import.meta.dirname,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: childEnv,
});

const stdoutLines = [];
const stderrChunks = [];
let buffer = '';

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) if (line.trim()) stdoutLines.push(line);
});
child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));

let nextId = 1;
const rpc = (method, params = {}) => {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      for (const line of stdoutLines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === id) {
            clearInterval(poll);
            return resolve(parsed);
          }
        } catch {
          /* purity is asserted separately */
        }
      }
      if (Date.now() - started > 20000) {
        clearInterval(poll);
        reject(new Error(`timed out waiting for ${method}`));
      }
    }, 50);
  });
};

const callTool = async (name, args = {}) => {
  const response = await rpc('tools/call', { name, arguments: args });
  const text = response.result?.content?.[0]?.text;

  // Our own results are JSON, but a schema rejection comes back as the SDK's
  // plain-text "Input validation error: …" — so parsing is best-effort. The
  // first version of this helper assumed JSON and crashed on exactly the case
  // it was written to check.
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  return {
    isError: response.result?.isError ?? false,
    parsed,
    text: text ?? null,
    protocolError: response.error ?? null,
  };
};

let passed = false;

try {
  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0.0.0' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

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
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const stderr = stderrChunks.join('');
results.childAuth = {
  authenticatedAsPatient: stderr.includes(`authenticated as patient #${patientA}`),
  registered: /\d+ read-only patient tool\(s\) registered/.test(stderr),
};

const unparseable = stdoutLines.filter((line) => {
  try {
    JSON.parse(line);
    return false;
  } catch {
    return true;
  }
});
results.stdoutPurity = {
  totalLines: stdoutLines.length,
  unparseableLines: unparseable.length,
  offenders: unparseable.slice(0, 2),
  verdict: unparseable.length === 0 ? 'CLEAN' : 'CORRUPTED',
};

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
  results.toolsList.count === 6 &&
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
