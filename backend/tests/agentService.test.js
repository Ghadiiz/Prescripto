import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { closeRedis } from '../src/config/redis.js';

import {
  generate,
  computeBackoffMs,
  ProviderError,
  resetBudget,
} from '../src/assistant/agentService.js';

// No network and no database: `fetch` is stubbed, so these run anywhere.
// The live request/response shape is verified separately against the real API.

const FAKE_KEY = 'test-key-do-not-use';
const realFetch = globalThis.fetch;
let calls;

const okBody = {
  candidates: [
    { content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' },
  ],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
};

const response = (status, body = {}, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

// Queue of responses; each call shifts one off.
const stubFetch = (queue) => {
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
};

beforeEach(async () => {
  // The daily call counter is module state shared across a whole suite. Left
  // to accumulate it would drift toward the cap and fail unrelated tests later
  // in the run — the same reason resetRateLimits() exists.
  await resetBudget();
  process.env.GEMINI_API_KEY = FAKE_KEY;
  // Keep retry waits negligible; the jitter maths is asserted directly below.
  process.env.GEMINI_RETRY_BASE_MS = '1';
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('429 then 200 retries once and returns the result', async () => {
  stubFetch([response(429, 'rate limited'), response(200, okBody)]);

  const result = await generate({
    messages: [{ role: 'user', content: 'hi' }],
  });

  assert.equal(calls.length, 2, 'should have retried exactly once');
  assert.equal(result.text, 'hello');
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 2 });
});

test('three 429s throw a retryable ProviderError after exactly 3 attempts', async () => {
  stubFetch([response(429, 'a'), response(429, 'b'), response(429, 'c')]);

  await assert.rejects(
    () => generate({ messages: [{ role: 'user', content: 'hi' }] }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 429);
      assert.equal(error.retryable, true);
      return true;
    },
  );

  assert.equal(calls.length, 3, 'must stop after MAX_ATTEMPTS');
});

test('400 throws immediately without retrying', async () => {
  stubFetch([response(400, 'bad request'), response(200, okBody)]);

  await assert.rejects(
    () => generate({ messages: [{ role: 'user', content: 'hi' }] }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.retryable, false, 'a 400 is a bug, not a blip');
      return true;
    },
  );

  assert.equal(calls.length, 1, 'a 400 must not be retried');
});

test('backoff uses full jitter within the expected window', () => {
  const base = Number(process.env.GEMINI_RETRY_BASE_MS);

  for (const attempt of [1, 2, 3]) {
    const window = base * 2 ** (attempt - 1);
    const samples = Array.from({ length: 50 }, () => computeBackoffMs(attempt));

    for (const value of samples) {
      assert.ok(value >= 0 && value <= window, `${value} outside [0, ${window}]`);
    }

    // Full jitter, not a fixed delay: identical samples would mean retries
    // synchronise, which is the failure this exists to prevent.
    assert.ok(
      new Set(samples).size > 1,
      `attempt ${attempt} produced a constant delay`,
    );
  }
});

test('Retry-After is honoured and capped', () => {
  assert.equal(computeBackoffMs(1, 2), 2000, 'should use the header value');
  assert.equal(
    computeBackoffMs(1, 3600),
    10_000,
    'a huge Retry-After must not hang the request',
  );
});

test('an aborted request surfaces as an abort, not a retry loop', async () => {
  const abortError = new Error('aborted');
  abortError.name = 'AbortError';
  stubFetch([abortError, response(200, okBody)]);

  await assert.rejects(
    () => generate({ messages: [{ role: 'user', content: 'hi' }] }),
    (error) => error.name === 'AbortError',
  );

  assert.equal(calls.length, 1, 'an abort is the caller’s decision, not a failure');
});

test('the API key never appears in a thrown error', async () => {
  // Provider error bodies sometimes echo the request, including the key.
  stubFetch([
    response(400, `invalid request for key=${FAKE_KEY}`),
  ]);

  await assert.rejects(
    () => generate({ messages: [{ role: 'user', content: 'hi' }] }),
    (error) => {
      assert.ok(
        !error.message.includes(FAKE_KEY),
        'the API key leaked into the error message',
      );
      assert.ok(error.message.includes('[REDACTED]'));
      assert.ok(
        !JSON.stringify(Object.values(error)).includes(FAKE_KEY),
        'the API key leaked into the error object',
      );
      return true;
    },
  );
});

test('the key is sent as a header, never in the URL', async () => {
  stubFetch([response(200, okBody)]);

  await generate({ messages: [{ role: 'user', content: 'hi' }] });

  assert.ok(
    !calls[0].url.includes(FAKE_KEY),
    'keys in URLs end up in logs and proxy traces',
  );
  assert.equal(calls[0].options.headers['x-goog-api-key'], FAKE_KEY);
});

test('a missing key fails clearly without calling the provider', async () => {
  delete process.env.GEMINI_API_KEY;
  stubFetch([response(200, okBody)]);

  await assert.rejects(
    () => generate({ messages: [{ role: 'user', content: 'hi' }] }),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /GEMINI_API_KEY/);
      return true;
    },
  );

  assert.equal(calls.length, 0);
});

test('our message shape maps to the provider shape, and back', async () => {
  stubFetch([
    response(200, {
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: 'search_doctors', args: { gender: 'Female' } } },
            ],
          },
        },
      ],
    }),
  ]);

  const result = await generate({
    system: 'be brief',
    messages: [
      { role: 'user', content: 'find doctors' },
      { role: 'assistant', content: 'checking' },
      { role: 'tool', name: 'search_doctors', content: '[]' },
    ],
    tools: [
      { name: 'search_doctors', description: 'find', parameters: { type: 'object' } },
    ],
  });

  const sent = JSON.parse(calls[0].options.body);

  // Outbound: our roles become the provider's.
  assert.equal(sent.contents[0].role, 'user');
  assert.equal(sent.contents[1].role, 'model', 'assistant maps to model');
  assert.ok(sent.contents[2].parts[0].functionResponse, 'tool maps to functionResponse');
  assert.equal(sent.systemInstruction.parts[0].text, 'be brief');
  assert.equal(sent.tools[0].functionDeclarations[0].name, 'search_doctors');

  // Inbound: nothing provider-shaped escapes.
  assert.deepEqual(result.toolCalls, [
    { name: 'search_doctors', args: { gender: 'Female' } },
  ]);
  assert.equal(result.finishReason, 'tool_calls');
  assert.deepEqual(Object.keys(result).sort(), [
    'finishReason',
    'text',
    'toolCalls',
    'usage',
  ]);
});
// 6.1: the stores may hold a Redis socket open, which would keep this process
// alive after the last test and hang the runner. Closing it is teardown, not
// cleanup of state.
after(async () => {
  await closeRedis();
});
