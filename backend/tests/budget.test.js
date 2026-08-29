import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { closeRedis } from '../src/config/redis.js';

import {
  generate,
  generateStream,
  getBudget,
  isAtCapacity,
  resetBudget,
  AtCapacityError,
  ProviderError,
} from '../src/assistant/agentService.js';

// Free-tier budget management. No network and no database — `fetch` is
// stubbed, so these run anywhere.
//
// Rotation is verified against a stubbed 429 rather than live: exhausting a
// model for real costs ~20 requests and would take that from 2.9's eval budget
// for no information the recorded body shape does not already give.

const FAKE_KEY = 'test-key-do-not-use';
const realFetch = globalThis.fetch;

const MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
];

let calls;

const okBody = {
  candidates: [
    { content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' },
  ],
};

// The shape Google actually returns when the DAILY quota is gone. The quota id
// was recorded from a real 429 during 2.2; what matters to the code under test
// is the "PerDay" substring, wherever in the body it sits.
const dailyQuotaBody = JSON.stringify({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message: 'You exceeded your current quota.',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
            quotaMetric: 'generativelanguage.googleapis.com/generate_requests',
          },
        ],
      },
    ],
  },
});

// The per-MINUTE limit. Same status code, opposite handling: this one clears
// in seconds and is worth retrying.
const perMinuteBody = JSON.stringify({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaId:
              'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
          },
        ],
      },
    ],
  },
});

const response = (status, body = {}, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

// A streamed 200. Response gives a real web stream, so body.getReader() is the
// same thing agentService reads from the live API.
const streamOk = (text) =>
  new Response(
    `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    })}\n\n`,
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );

const stubFetch = (queue) => {
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
};

// Which model each request went to, in order — the observable evidence that
// rotation happened.
const modelsCalled = () =>
  calls.map((call) => call.url.match(/models\/([^:]+):/)[1]);

const drain = async (stream) => {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
};

beforeEach(async () => {
  await resetBudget();
  process.env.GEMINI_API_KEY = FAKE_KEY;
  process.env.GEMINI_RETRY_BASE_MS = '1';
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODELS;
  delete process.env.GEMINI_DAILY_CALL_CAP;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODELS;
  delete process.env.GEMINI_DAILY_CALL_CAP;
  await resetBudget();
});

// --- rotation ---------------------------------------------------------------

test('a daily-quota 429 rotates to the next model instead of retrying', async () => {
  stubFetch([response(429, dailyQuotaBody), response(200, okBody)]);

  const result = await generate({ messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(result.text, 'hello');
  assert.deepEqual(
    modelsCalled(),
    [MODELS[0], MODELS[1]],
    'the second request must go to a DIFFERENT model',
  );
  assert.deepEqual((await getBudget()).exhaustedModels, [MODELS[0]]);
});

test('a per-minute 429 retries the same model — it clears in seconds', async () => {
  stubFetch([response(429, perMinuteBody), response(200, okBody)]);

  await generate({ messages: [{ role: 'user', content: 'hi' }] });

  assert.deepEqual(
    modelsCalled(),
    [MODELS[0], MODELS[0]],
    'a rate blip must not burn a model for the whole day',
  );
  assert.deepEqual(
    (await getBudget()).exhaustedModels,
    [],
    'nothing is exhausted by a per-minute limit',
  );
});

test('rotation is sticky — the next turn starts on the surviving model', async () => {
  stubFetch([response(429, dailyQuotaBody), response(200, okBody)]);
  await generate({ messages: [{ role: 'user', content: 'hi' }] });

  // A second, entirely separate turn.
  stubFetch([response(200, okBody)]);
  await generate({ messages: [{ role: 'user', content: 'again' }] });

  assert.deepEqual(
    modelsCalled(),
    [MODELS[1]],
    'a spent model must not be re-probed — that would cost a call per turn',
  );
});

test('every model exhausted throws AtCapacityError and stops calling out', async () => {
  stubFetch([
    response(429, dailyQuotaBody),
    response(429, dailyQuotaBody),
    response(429, dailyQuotaBody),
  ]);

  await assert.rejects(
    () => generate({ messages: [{ role: 'user', content: 'hi' }] }),
    (error) => {
      assert.ok(error instanceof AtCapacityError);
      assert.ok(
        !(error instanceof ProviderError),
        'at-capacity is a budget state, not a provider failure',
      );
      return true;
    },
  );

  assert.deepEqual(modelsCalled(), MODELS, 'all three tried exactly once');
  assert.equal(await isAtCapacity(), true);

  // And the next turn does not try again.
  const before = calls.length;
  await assert.rejects(
    () => generate({ messages: [{ role: 'user', content: 'hi' }] }),
    AtCapacityError,
  );
  assert.equal(calls.length, before, 'no request once every model is spent');
});

test('the streaming path rotates too — a 429 arrives before any byte is yielded', async () => {
  stubFetch([response(429, dailyQuotaBody), streamOk('streamed')]);

  const events = await drain(
    generateStream({ messages: [{ role: 'user', content: 'hi' }] }),
  );

  assert.deepEqual(modelsCalled(), [MODELS[0], MODELS[1]]);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).text, 'streamed');
});

// --- the daily soft-cap -----------------------------------------------------

test('the counter counts actual calls including retries, not user turns', async () => {
  // One caller-visible request that costs three provider calls.
  stubFetch([
    response(429, perMinuteBody),
    response(429, dailyQuotaBody),
    response(200, okBody),
  ]);

  await generate({ messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(
    (await getBudget()).callsToday,
    3,
    'a retry is a real request against the quota and must be counted',
  );
});

test('at the cap, nothing is sent at all', async () => {
  process.env.GEMINI_DAILY_CALL_CAP = '2';
  stubFetch([response(200, okBody), response(200, okBody), response(200, okBody)]);

  await generate({ messages: [{ role: 'user', content: 'one' }] });
  await generate({ messages: [{ role: 'user', content: 'two' }] });

  assert.equal((await getBudget()).remaining, 0);
  assert.equal(await isAtCapacity(), true);

  await assert.rejects(
    () => generate({ messages: [{ role: 'user', content: 'three' }] }),
    AtCapacityError,
  );

  assert.equal(
    calls.length,
    2,
    'the cap must stop us BEFORE the request, not after',
  );
});

test('the cap is read at call time, not captured at import', async () => {
  stubFetch([response(200, okBody), response(200, okBody)]);
  await generate({ messages: [{ role: 'user', content: 'hi' }] });

  // Lowering it below the calls already made trips it immediately. A value
  // captured at import would ignore this — the bug a 2.2 test caught in
  // baseDelayMs.
  process.env.GEMINI_DAILY_CALL_CAP = '1';
  assert.equal(await isAtCapacity(), true);

  process.env.GEMINI_DAILY_CALL_CAP = '99';
  assert.equal(await isAtCapacity(), false);
});

// --- the UTC-midnight reset -------------------------------------------------

test('crossing UTC midnight clears both the count and the exhausted models', async () => {
  stubFetch([response(429, dailyQuotaBody), response(200, okBody)]);
  await generate({ messages: [{ role: 'user', content: 'hi' }] });

  // Derived from the real clock, never hardcoded. The first version of this
  // test pinned 2026-08-21/22 and passed only on the day it was written: once
  // the real date moved on, generate() above stamped the budget with the REAL
  // day, so reading it back at a hardcoded "today" looked like a rollover,
  // zeroed the counter, and failed the assertion below. The test broke
  // precisely because the rollover logic works.
  const todayUtc = new Date().toISOString().slice(0, 10);
  const today = Date.parse(`${todayUtc}T23:59:00Z`);
  const tomorrow = today + 2 * 60 * 1000;
  const tomorrowUtc = new Date(tomorrow).toISOString().slice(0, 10);

  const before = await getBudget(today);
  assert.equal(before.day, todayUtc);
  assert.ok(before.callsToday > 0);
  assert.ok(before.exhaustedModels.length > 0);

  const after = await getBudget(tomorrow);
  assert.equal(after.day, tomorrowUtc);
  assert.notEqual(tomorrowUtc, todayUtc, 'the two instants must straddle midnight');
  assert.equal(after.callsToday, 0, 'the daily count resets');
  assert.deepEqual(
    after.exhaustedModels,
    [],
    'a model spent yesterday is available again today',
  );
  assert.equal(await isAtCapacity(tomorrow), false);
});

// --- configuring the rotation -----------------------------------------------

test('GEMINI_MODEL sets where rotation STARTS, it no longer pins', async () => {
  process.env.GEMINI_MODEL = MODELS[2];
  stubFetch([response(429, dailyQuotaBody), response(200, okBody)]);

  await generate({ messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(modelsCalled()[0], MODELS[2], 'starts where asked');
  assert.notEqual(
    modelsCalled()[1],
    MODELS[2],
    'and still falls through — an env file must not disable degradation',
  );
  assert.equal(
    new Set(modelsCalled()).size,
    2,
    'the preferred model appears once, not twice',
  );
});

test('GEMINI_MODELS replaces the list, and a single id pins one model', async () => {
  process.env.GEMINI_MODELS = MODELS[1];
  stubFetch([response(429, dailyQuotaBody), response(200, okBody)]);

  // 2.9 targets one model this way: nothing to fall through to, so the turn
  // ends at capacity rather than quietly answering from a different model.
  await assert.rejects(
    () => generate({ messages: [{ role: 'user', content: 'hi' }] }),
    AtCapacityError,
  );

  assert.deepEqual(modelsCalled(), [MODELS[1]]);
});

test('nothing provider-specific rides along on the capacity signal', async () => {
  stubFetch([
    response(429, dailyQuotaBody),
    response(429, dailyQuotaBody),
    response(429, dailyQuotaBody),
  ]);

  const error = await generate({
    messages: [{ role: 'user', content: 'hi' }],
  }).catch((caught) => caught);

  // The endpoint renders this to a patient. It must not carry a model id, a
  // status code, a quota id, or the key.
  const serialised = `${error.message} ${JSON.stringify(Object.values(error))}`;
  for (const forbidden of [...MODELS, 'gemini', 'quota', '429', FAKE_KEY]) {
    assert.ok(
      !serialised.toLowerCase().includes(forbidden.toLowerCase()),
      `"${forbidden}" must not ride along on AtCapacityError`,
    );
  }
});
// 6.1: the stores may hold a Redis socket open, which would keep this process
// alive after the last test and hang the runner. Closing it is teardown, not
// cleanup of state.
after(async () => {
  await closeRedis();
});
