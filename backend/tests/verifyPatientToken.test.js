import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import {
  verifyPatientToken,
  TokenError,
} from '../src/auth/verifyPatientToken.js';

// The single definition of "a verified patient", used by the HTTP middleware
// and by the MCP server. No network, no database.
//
// Rule 3 rests on this function: if it hands back the wrong identity, every
// tool that scopes on ctx.userId reads the wrong person's data.

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
    verifyPatientToken(token);
    return null;
  } catch (error) {
    return error instanceof TokenError ? error.code : `threw ${error.name}`;
  }
};

test('a valid patient token becomes a ctx, and nothing else', () => {
  const ctx = verifyPatientToken(sign({ id: 78, role: 'patient' }));

  assert.deepEqual(ctx, { userId: 78, role: 'patient' });

  // The decoded payload must NOT leak through. A caller handed `iat`, `exp`
  // or a stray claim could start making its own identity decisions, which is
  // exactly what rule 3 forbids.
  assert.deepEqual(Object.keys(ctx).sort(), ['role', 'userId']);
});

test('identity comes from the id claim and nothing else', () => {
  // A mutation swapping `decoded.id` for `decoded.sub ?? decoded.id` survived
  // the first version of this suite, because none of its tokens carried a
  // `sub`. The claim a caller might smuggle in is exactly the one to test.
  const ctx = verifyPatientToken(
    sign({
      id: 78,
      role: 'patient',
      sub: 999,
      userId: 999,
      user_id: 999,
      patient_id: 999,
    }),
  );

  assert.equal(ctx.userId, 78, 'decoy claims must not shift who the caller is');
});

test('the id is carried through as a number, not a string', () => {
  // my_appointments refuses a non-integer ctx.userId, so a stringified id
  // would fail at the tool layer with a confusing error rather than here.
  const ctx = verifyPatientToken(sign({ id: 78, role: 'patient' }));

  assert.equal(typeof ctx.userId, 'number');
  assert.ok(Number.isInteger(ctx.userId));
});

test('a doctor or admin token is refused, however valid its signature', () => {
  // The signature is genuine — this is the right key, the wrong person.
  assert.equal(codeOf(sign({ id: 78, role: 'doctor' })), 'wrong_role');
  assert.equal(codeOf(sign({ id: 1, role: 'admin' })), 'wrong_role');
  assert.equal(codeOf(sign({ id: 78 })), 'wrong_role', 'no role at all');
});

test('expired, forged and absent tokens are each told apart', () => {
  assert.equal(codeOf(sign({ id: 78, role: 'patient' }, { expiresIn: '-1h' })), 'expired');
  assert.equal(
    codeOf(sign({ id: 78, role: 'patient' }, {}, 'not-the-secret')),
    'invalid',
  );
  assert.equal(codeOf(undefined), 'no_token');
  assert.equal(codeOf(''), 'no_token');
  assert.equal(codeOf('not-a-jwt-at-all'), 'invalid');
});

test('a missing JWT_SECRET is the operator’s error, not a bad token', () => {
  delete process.env.JWT_SECRET;

  // Reporting this as `invalid` would send someone hunting for a token
  // problem that does not exist.
  const code = codeOf(sign({ id: 78, role: 'patient' }, {}, SECRET));
  assert.notEqual(code, 'invalid');
  assert.notEqual(code, 'expired');
});

test('a token signed by the real secret does not verify under another', () => {
  // Guards the obvious catastrophe: verification actually checking the
  // signature rather than merely decoding it.
  const token = sign({ id: 78, role: 'patient' }, {}, 'some-other-issuer');

  assert.throws(
    () => verifyPatientToken(token),
    (error) => error instanceof TokenError && error.code === 'invalid',
  );
});
