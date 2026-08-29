import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { closeRedis, isRedisEnabled, withRedis } from '../src/config/redis.js';
import {
  checkRateLimit,
  resetRateLimits,
  MAX_REQUESTS_PER_HOUR,
} from '../src/assistant/rateLimit.js';
import {
  issueConfirmation,
  spendConfirmation,
  resetConfirmations,
} from '../src/assistant/confirmations.js';
import {
  getBudget,
  resetBudget,
  isAtCapacity,
} from '../src/assistant/agentService.js';

// The Redis path (6.1).
//
// These need a REAL Redis, because what they assert is behaviour a fake would
// have to imitate — GETDEL's atomicity, a sorted set surviving a restart, a
// key expiring. `docker run -p 6379:6379 redis:7-alpine`, then
// REDIS_URL=redis://localhost:6379.
//
// SKIPPED, loudly, when REDIS_URL is unset. The rest of the suite covers the
// in-memory path, and a green run with these silently skipped would be a lie
// about what was verified.

const ENABLED = Boolean(process.env.REDIS_URL);
const skip = ENABLED
  ? false
  : 'REDIS_URL is not set — start Redis and set it to exercise the Redis path';

const CTX = { userId: 4242, role: 'patient' };
const SESSION = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
const ARGS = { doctor_id: 7, date_from: '2031-05-01', date_to: '2031-05-07' };

before(async () => {
  if (!ENABLED) return;

  // Proves the URL actually points at something before any test blames the
  // code for a connection problem. No explicit connect(): withRedis waits for
  // readiness itself now, and a test that hand-connected would have hidden the
  // first-command bug this suite found.
  const { value: info } = await withRedis((r) => r.info('server'));
  assert.ok(info, 'could not reach Redis at REDIS_URL');
  const version = /redis_version:([\d.]+)/.exec(info)?.[1] ?? '0';
  const [major, minor] = version.split('.').map(Number);

  assert.ok(
    major > 6 || (major === 6 && minor >= 2),
    `GETDEL needs Redis 6.2+, found ${version}`,
  );
});

beforeEach(async () => {
  if (!ENABLED) return;
  await resetRateLimits();
  await resetConfirmations();
  await resetBudget();
});

after(async () => {
  if (!ENABLED) return;
  await resetRateLimits();
  await resetConfirmations();
  await resetBudget();
  await closeRedis();
});

// --- the thing memory cannot do ---------------------------------------------

test('the rate limit survives a restart', { skip }, async () => {
  assert.equal(isRedisEnabled(), true);

  for (let i = 0; i < MAX_REQUESTS_PER_HOUR; i += 1) {
    const result = await checkRateLimit(CTX.userId);
    assert.equal(result.allowed, true, `hit ${i + 1} should be allowed`);
    assert.equal(result.store, 'redis', 'this must be the Redis path, not the fallback');
  }

  // A RESTART, simulated the only way that is honest here: the module's own
  // memory is irrelevant because the count lives in Redis. Re-importing with a
  // cache-buster gives a module whose in-memory Map is empty.
  const fresh = await import(
    `../src/assistant/rateLimit.js?restart=${Date.now()}`
  );

  const after = await fresh.checkRateLimit(CTX.userId);

  assert.equal(
    after.allowed,
    false,
    'a fresh process must still see the limit — this is the whole point of 6.1',
  );
  assert.ok(after.retryAfterSeconds > 0);
});

test('limits are per user, not shared', { skip }, async () => {
  for (let i = 0; i < MAX_REQUESTS_PER_HOUR; i += 1) {
    await checkRateLimit(CTX.userId);
  }

  assert.equal((await checkRateLimit(CTX.userId)).allowed, false);
  assert.equal(
    (await checkRateLimit(CTX.userId + 1)).allowed,
    true,
    'one user exhausting their budget must not spend another user’s',
  );
});

test('the rate-limit key carries a TTL', { skip }, async () => {
  await checkRateLimit(CTX.userId);

  const { value: ttl } = await withRedis((redis) =>
    redis.pttl(`prescripto:ratelimit:${CTX.userId}`),
  );

  // -1 means "no expiry set", which would leak a key per user forever.
  assert.ok(ttl > 0, `expected a positive TTL, got ${ttl}`);
  assert.ok(ttl <= 60 * 60 * 1000);
});

// --- the write tool's guarantee ---------------------------------------------

test('a confirmation token is single use', { skip }, async () => {
  const token = await issueConfirmation(CTX, SESSION, ARGS);

  assert.equal(await spendConfirmation(token, CTX, SESSION, ARGS), true);
  assert.equal(
    await spendConfirmation(token, CTX, SESSION, ARGS),
    false,
    'a replayed token must not authorise a second write',
  );
});

test('a confirmation survives a restart', { skip }, async () => {
  const token = await issueConfirmation(CTX, SESSION, ARGS);

  const fresh = await import(
    `../src/assistant/confirmations.js?restart=${Date.now()}`
  );

  assert.equal(
    await fresh.spendConfirmation(token, CTX, SESSION, ARGS),
    true,
    'a restart mid-conversation must no longer invalidate a pending confirmation',
  );
});

test('a token is bound to who, where and what', { skip }, async () => {
  const cases = {
    'another patient': [{ userId: 9999, role: 'patient' }, SESSION, ARGS],
    'another session': [CTX, 'cccccccc-9999-8888-7777-dddddddddddd', ARGS],
    'a different doctor': [CTX, SESSION, { ...ARGS, doctor_id: 8 }],
    'different dates': [CTX, SESSION, { ...ARGS, date_to: '2031-05-09' }],
  };

  for (const [label, [ctx, session, args]] of Object.entries(cases)) {
    const token = await issueConfirmation(CTX, SESSION, ARGS);
    assert.equal(
      await spendConfirmation(token, ctx, session, args),
      false,
      `a token spent by ${label} must be refused`,
    );
  }
});

// --- degraded: the one place that fails closed ------------------------------

// Points the stores at a URL nothing answers on, WITHOUT unsetting it — which
// is the DEGRADED state, distinct from being unconfigured.
const whileDegraded = async (work) => {
  const real = process.env.REDIS_URL;
  await closeRedis();
  process.env.REDIS_URL = 'redis://127.0.0.1:6399';

  try {
    return await work();
  } finally {
    await closeRedis();
    process.env.REDIS_URL = real;
  }
};

test('a confirmation is REFUSED while Redis is degraded', { skip }, async () => {
  const token = await issueConfirmation(CTX, SESSION, ARGS);

  const spent = await whileDegraded(() =>
    spendConfirmation(token, CTX, SESSION, ARGS),
  );

  assert.equal(
    spent,
    false,
    'with no way to prove single use, the write must be declined',
  );
});

test('the token is still good once Redis returns', { skip }, async () => {
  // The refusal above must not have consumed it: a Redis blip should cost a
  // retry, not the patient's confirmation.
  const token = await issueConfirmation(CTX, SESSION, ARGS);

  await whileDegraded(() => spendConfirmation(token, CTX, SESSION, ARGS));

  assert.equal(await spendConfirmation(token, CTX, SESSION, ARGS), true);
});

test('the rate limiter FALLS BACK while Redis is degraded', { skip }, async () => {
  const result = await whileDegraded(() => checkRateLimit(CTX.userId));

  assert.equal(result.allowed, true, 'a Redis fault must not deny the assistant');
  assert.equal(result.store, 'memory', 'it should have fallen back, not failed');
});

test('the budget FALLS BACK while Redis is degraded', { skip }, async () => {
  const budget = await whileDegraded(() => getBudget());

  assert.equal(budget.store, 'memory');
  assert.equal(await whileDegraded(() => isAtCapacity()), false);
});

// --- the daily budget --------------------------------------------------------

test('the budget is stored in Redis and is day-keyed', { skip }, async () => {
  const budget = await getBudget();

  assert.equal(budget.store, 'redis');
  assert.equal(budget.callsToday, 0);

  const today = new Date().toISOString().slice(0, 10);
  const { value: keyExists } = await withRedis((redis) =>
    redis.exists(`prescripto:budget:${today}:calls`),
  );

  // Nothing has been called yet, so the key should not exist — the counter is
  // created by a call, not by reading.
  assert.equal(keyExists, 0);
});

test('a new UTC day is a different budget', { skip }, async () => {
  const today = Date.now();
  const tomorrow = today + 24 * 60 * 60 * 1000;
  const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

  // Seed a REAL count against today's key.
  //
  // The first version of this test asserted only that the two `day` labels
  // differed and that both counts were 0 — which is true whether or not the
  // KEY carries the date, so the mutation that undayed the key passed it. A
  // rollover test has to read a count that exists.
  await withRedis((redis) =>
    redis.set(`prescripto:budget:${dayOf(today)}:calls`, '7'),
  );

  const a = await getBudget(today);
  const b = await getBudget(tomorrow);

  assert.equal(a.callsToday, 7, 'today must read the count that was stored');
  assert.notEqual(a.day, b.day, 'the day label must roll over');
  assert.equal(
    b.callsToday,
    0,
    'tomorrow must read a DIFFERENT key — an undayed key would still see 7',
  );
});
