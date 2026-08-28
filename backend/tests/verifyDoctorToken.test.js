import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import {
  verifyDoctorToken,
  TokenError,
} from '../src/doctors/verifyDoctorToken.js';
import { authenticateDoctor } from '../src/doctors/middleware/doctorAuthMiddleware.js';

// The single definition of "a verified doctor", used by the doctor panel's
// HTTP middleware and by mcp/doctor-server.js. No network, no database.
//
// Rule 3 rests on this function: if it hands back the wrong identity, every
// doctor tool that scopes on ctx.doctorId reads the wrong practice.

const SECRET = 'test-secret-for-verification';
const realSecret = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
});

afterEach(() => {
  process.env.JWT_SECRET = realSecret;
});

const sign = (payload, options = {}, secret = SECRET) =>
  jwt.sign(payload, secret, { expiresIn: '1h', ...options });

const codeOf = (token) => {
  try {
    verifyDoctorToken(token);
    return null;
  } catch (error) {
    return error instanceof TokenError ? error.code : `threw ${error.name}`;
  }
};

test('a valid doctor token becomes a ctx, and nothing else', () => {
  const ctx = verifyDoctorToken(sign({ id: 12, role: 'doctor' }));

  // `doctorId`, not `userId` — the 5.5 shape. A ctx with `userId` here would
  // be read by the patient tools as a patient id for a different person.
  assert.deepEqual(ctx, { doctorId: 12, role: 'doctor' });
  assert.deepEqual(Object.keys(ctx).sort(), ['doctorId', 'role']);
});

test('identity comes from the id claim and nothing else', () => {
  const ctx = verifyDoctorToken(
    sign({
      id: 12,
      role: 'doctor',
      sub: 999,
      doctorId: 999,
      doctor_id: 999,
      userId: 999,
    }),
  );

  assert.equal(ctx.doctorId, 12, 'decoy claims must not shift who the caller is');
});

test('the id is carried through as a number, not a string', () => {
  // requireDoctor refuses a non-integer ctx.doctorId, so a stringified id
  // would fail at the tool layer with a confusing error rather than here.
  const ctx = verifyDoctorToken(sign({ id: 12, role: 'doctor' }));

  assert.equal(typeof ctx.doctorId, 'number');
  assert.ok(Number.isInteger(ctx.doctorId));
});

test('a patient or admin token is refused, however valid its signature', () => {
  // The signature is genuine — this is the right key, the wrong person. And
  // this is the case that matters most on this side: patient #12 and doctor
  // #12 are different people, so a patient token accepted here would return
  // some doctor's entire schedule.
  assert.equal(codeOf(sign({ id: 12, role: 'patient' })), 'wrong_role');
  assert.equal(codeOf(sign({ id: 1, role: 'admin' })), 'wrong_role');
  assert.equal(codeOf(sign({ id: 12 })), 'wrong_role', 'no role at all');
});

test('expired, forged and absent tokens are each told apart', () => {
  assert.equal(
    codeOf(sign({ id: 12, role: 'doctor' }, { expiresIn: '-1h' })),
    'expired',
  );
  assert.equal(
    codeOf(sign({ id: 12, role: 'doctor' }, {}, 'not-the-secret')),
    'invalid',
  );
  assert.equal(codeOf(undefined), 'no_token');
  assert.equal(codeOf(''), 'no_token');
  assert.equal(codeOf('not-a-jwt-at-all'), 'invalid');
});

test('a missing JWT_SECRET reports misconfigured, not invalid', () => {
  // The Known Issue 5.5 filed, pinned.
  //
  // Without the check that precedes jwt.verify, jsonwebtoken throws
  // JsonWebTokenError("secret or public key must be provided") — the same
  // class a forged token throws — and the doctor is told their token is bad
  // for a mistake that is entirely ours.
  //
  // Deleting the variable in-process is a real mutation of what the function
  // reads, so no child process is needed here: with the check removed this
  // assertion returns 'invalid' and fails.
  delete process.env.JWT_SECRET;

  assert.equal(codeOf(sign({ id: 12, role: 'doctor' }, {}, SECRET)), 'misconfigured');
});

// --- the HTTP mapping ---------------------------------------------------------

const callMiddleware = (authorization) => {
  const req = { headers: authorization ? { authorization } : {} };
  const captured = { status: null, body: null, nexted: false };

  const res = {
    status(code) {
      captured.status = code;
      return res;
    },
    json(body) {
      captured.body = body;
      return res;
    },
  };

  authenticateDoctor(req, res, () => {
    captured.nexted = true;
  });

  return { ...captured, req };
};

test('the middleware puts the doctor id on the request and calls next', () => {
  const result = callMiddleware(`Bearer ${sign({ id: 12, role: 'doctor' })}`);

  assert.equal(result.nexted, true);
  assert.equal(result.status, null);
  // All eight controller uses read req.doctor.id — this is the contract the
  // rewrite had to preserve.
  assert.equal(result.req.doctor.id, 12);
});

test('req.doctor carries identity only', () => {
  // `email` used to be copied off the token claim and read by nothing. The
  // verifier returns identity and nothing else, so neither does this.
  const result = callMiddleware(
    `Bearer ${sign({ id: 12, role: 'doctor', email: 'doc@example.invalid' })}`,
  );

  assert.deepEqual(Object.keys(result.req.doctor), ['id']);
  assert.equal(result.req.doctor.email, undefined);
});

test('each failure maps to the status it deserves', () => {
  assert.equal(callMiddleware(undefined).status, 401, 'no token');
  assert.equal(
    callMiddleware(`Bearer ${sign({ id: 12, role: 'doctor' }, { expiresIn: '-1h' })}`).status,
    401,
    'expired',
  );
  assert.equal(callMiddleware('Bearer not-a-jwt').status, 401, 'malformed');
  assert.equal(
    callMiddleware(`Bearer ${sign({ id: 12, role: 'patient' })}`).status,
    403,
    'valid signature, wrong role',
  );
});

test('a missing JWT_SECRET is a 500, not a 401', () => {
  // The whole point of the rewrite. A 401 tells the doctor to sign in again,
  // which cannot possibly help, and hides an operator error behind a user
  // error. `misconfigured` has no entry in STATUS_BY_CODE precisely so it
  // falls through to the 500.
  delete process.env.JWT_SECRET;

  const result = callMiddleware(`Bearer ${sign({ id: 12, role: 'doctor' }, {}, SECRET)}`);

  assert.equal(result.status, 500);
  assert.equal(result.nexted, false);
  // And the response must not imply the token was at fault.
  assert.ok(!/token/i.test(result.body.message), result.body.message);
});
