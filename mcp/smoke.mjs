// Smoke check for the patient MCP server. Run with `npm run smoke`.
//
// Speaks real JSON-RPC to patient-server.js over a real stdio pipe, and drives
// the real auth path with a real token file — so it exercises the mechanism
// rather than describing it. No Claude Desktop needed.
//
// Two assertions carry the weight:
//
//   stdout PURITY — every line the server writes to stdout must parse as JSON,
//   because on this transport stdout IS the protocol. Verified load-bearing by
//   removing stdioGuard.js's import, which makes this exit 1 with a dotenv
//   banner as the offender.
//
//   THE CHILD'S OWN AUTH — the spawned server is given a token file and must
//   report `authenticated as patient #N`. That is what proves env.js found
//   backend/.env from inside the real process; asserting only on in-process
//   helpers would pass even with env.js removed.
//
// This file is the only automated check the mcp/ package has — there is no
// test runner here, the same gap docs/agent-plan.md records for frontend/.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import './env.js';
import jwt from '../backend/node_modules/jsonwebtoken/index.js';
import { createContext, TOKEN_FILE_VAR } from './context.js';

const PATIENT_ID = 78;
const results = {};

const scratch = mkdtempSync(join(tmpdir(), 'prescripto-mcp-'));
const tokenPath = join(scratch, 'token');
const originalTokenVar = process.env[TOKEN_FILE_VAR];

const sign = (payload, options = {}, secret = process.env.JWT_SECRET) =>
  jwt.sign(payload, secret, { expiresIn: '1h', ...options });

// --- 1. the server, spawned with a token file it must actually verify -------

writeFileSync(tokenPath, `${sign({ id: PATIENT_ID, role: 'patient' })}\n`);

// The child is given a SCRUBBED environment: everything backend/.env supplies
// is stripped, so the server has to find and load that file itself. Passing
// `{...process.env}` would hand it the values this test process already
// loaded, and the check would pass even with env.js removed — which is exactly
// what happened the first time, producing a mutation test that caught nothing.
//
// It is also the truer simulation: a host launches this from its own config
// with a clean environment, not from a shell where the backend's env happens
// to be loaded.
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

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

const waitFor = (id, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
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
          /* purity is asserted separately, below */
        }
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(poll);
        reject(new Error(`timed out waiting for id ${id}`));
      }
    }, 50);
  });

try {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0.0.0' },
    },
  });

  const initialize = await waitFor(1);
  results.initialize = {
    ok: Boolean(initialize.result),
    serverInfo: initialize.result?.serverInfo,
    error: initialize.error ?? null,
  };
} catch (error) {
  results.failure = error.message;
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const stderr = stderrChunks.join('');

results.childAuth = {
  line: stderr.trim().split('\n').find((l) => l.includes('ready on stdio')) ?? null,
  authenticatedAsPatient: stderr.includes(`authenticated as patient #${PATIENT_ID}`),
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
  offenders: unparseable.slice(0, 3),
  verdict: unparseable.length === 0 ? 'CLEAN' : 'CORRUPTED',
};

// --- 2. every way a token can be wrong, told apart --------------------------

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
let authOk = false;

try {
  const good = attempt(`${sign({ id: PATIENT_ID, role: 'patient' })}\n`);
  auth.validPatient = {
    ctx: good.ctx,
    // Trailing newline is what `echo "$TOKEN" > file` produces.
    trailingNewlineTolerated: Boolean(good.ctx),
  };

  // Identity comes from the `id` claim and nothing else. A token carrying
  // decoy claims must not shift who the caller is.
  const decoy = attempt(
    sign({ id: PATIENT_ID, role: 'patient', sub: 999, userId: 999, user_id: 999 }),
  );
  auth.decoyClaimsIgnored = decoy.ctx?.userId === PATIENT_ID;

  auth.expired = attempt(sign({ id: PATIENT_ID, role: 'patient' }, { expiresIn: '-1h' }));
  auth.wrongSecret = attempt(sign({ id: PATIENT_ID, role: 'patient' }, {}, 'not-the-secret'));
  auth.doctorToken = attempt(sign({ id: PATIENT_ID, role: 'doctor' }));
  auth.emptyFile = attempt('   ');
  auth.noVariable = attempt(null);

  const secretToken = sign({ id: PATIENT_ID, role: 'patient' });
  const everyMessage = Object.values(auth)
    .map((entry) => entry?.message ?? '')
    .join(' ');
  auth.tokenNeverLeaks = !everyMessage.includes(secretToken.slice(0, 24));

  authOk =
    auth.validPatient.ctx?.userId === PATIENT_ID &&
    auth.validPatient.ctx?.role === 'patient' &&
    auth.decoyClaimsIgnored &&
    auth.expired.code === 'expired' &&
    auth.wrongSecret.code === 'invalid' &&
    auth.doctorToken.code === 'wrong_role' &&
    auth.emptyFile.code === 'no_token' &&
    auth.noVariable.code === 'no_token' &&
    auth.tokenNeverLeaks;
} finally {
  if (originalTokenVar === undefined) delete process.env[TOKEN_FILE_VAR];
  else process.env[TOKEN_FILE_VAR] = originalTokenVar;
  rmSync(scratch, { recursive: true, force: true });
}

auth.verdict = authOk ? 'PASS' : 'FAIL';
results.auth = auth;

const passed =
  results.stdoutPurity.verdict === 'CLEAN' &&
  !results.failure &&
  results.initialize?.ok &&
  results.childAuth.authenticatedAsPatient &&
  authOk;

console.log(JSON.stringify(results, null, 1));
process.exit(passed ? 0 : 1);
