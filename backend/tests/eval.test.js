import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  startHarness,
  tokenFor,
  runCase,
  createEvalPatient,
  deleteEvalPatient,
} from '../evals/harness.js';
import { mockedCases } from '../evals/cases.js';
import { resetBudget } from '../src/assistant/agentService.js';
import { resetRateLimits } from '../src/assistant/rateLimit.js';

// The MOCKED half of the 2.9 eval. The live half lives in evals/runLive.js and
// is never picked up here — Node's default discovery matches *.test.js, and
// nothing under evals/ is named that way.
//
// Every case drives the real endpoint over real HTTP with the real tools
// against the real database. Only the provider is scripted, which is what
// makes these deterministic, free, and safe to run in CI.

const realFetch = globalThis.fetch;

let harness;
let ctx;
let token;
let requests;

// Serves one scripted response per provider call, as SSE, so agentService's
// real stream parsing is exercised rather than bypassed.
const scriptProvider = (script) => {
  const queue = [...script];
  requests = [];

  globalThis.fetch = async (url, options) => {
    if (!String(url).includes('generativelanguage')) {
      return realFetch(url, options);
    }

    requests.push(JSON.parse(options.body));

    const chunks = queue.shift() ?? [
      { candidates: [{ content: { parts: [{ text: '' }] } }] },
    ];

    return new Response(
      chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join(''),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
};

before(async () => {
  process.env.GEMINI_API_KEY = 'test-key-do-not-use';

  harness = await startHarness();

  // The eval owns its patient, so a run leaves real rows untouched.
  const userId = await createEvalPatient(harness.db, 'mock');
  ctx = { userId, role: 'patient' };
  token = tokenFor(userId);
});

after(async () => {
  if (ctx) await deleteEvalPatient(harness.db, ctx.userId);
  await harness.close();
});

const cleanup = async () => {
  resetRateLimits();
  resetBudget();
  await harness.db.query('DELETE FROM conversations WHERE user_id = ?', [
    ctx.userId,
  ]);
  await harness.db.query('DELETE FROM assistant_audit_log WHERE user_id = ?', [
    ctx.userId,
  ]);
};

beforeEach(cleanup);
afterEach(async () => {
  globalThis.fetch = realFetch;
  await cleanup();
});

for (const testCase of mockedCases) {
  test(`${testCase.id} — ${testCase.title}`, async () => {
    scriptProvider(testCase.script);

    const result = await runCase({
      chat: harness.chat,
      db: harness.db,
      token,
      messages: testCase.messages,
    });

    await testCase.assert({
      ...result,
      requests,
      db: harness.db,
      ctx,
    });
  });
}

test('every mocked case is actually mocked', () => {
  // A live case reaching this runner would spend quota inside `npm test`.
  for (const testCase of mockedCases) {
    assert.equal(testCase.mode, 'mock', `${testCase.id} is not a mock case`);
    assert.ok(testCase.script, `${testCase.id} has no scripted provider`);
  }
});
