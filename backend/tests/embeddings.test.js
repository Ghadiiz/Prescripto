import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  embedDocuments,
  embedQuery,
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
} from '../src/assistant/embeddings.js';

// The embedding client, with `fetch` stubbed.
//
// Offline and deterministic on purpose: a suite that called the real API would
// spend quota on every run, fail when the network does, and give a different
// answer each time. The real contract is covered by the opt-in live test at the
// bottom, so the stubs cannot drift from it unnoticed either.

const realFetch = globalThis.fetch;
let calls = [];

afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
  delete process.env.EMBEDDINGS_TEST_KEY_UNSET;
});

const stubFetch = (responder) => {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return responder(calls.length);
  };
};

const ok = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  headers: { get: () => null },
});

const fail = (status, body = '{"error":"nope"}') => ({
  ok: false,
  status,
  text: async () => body,
  headers: { get: () => null },
});

// A vector that is deliberately NOT unit-length, like the API's real 768
// output (measured at 0.591345).
const rawVector = (dims = EMBEDDING_DIM, scale = 0.5) =>
  Array.from({ length: dims }, (_, i) => (scale * (i + 1)) / dims);

const magnitude = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

const withKey = (fn) => async () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key-not-a-real-one';
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
};

// --- the request ------------------------------------------------------------

test('a document request names the model, task type and dimension', withKey(async () => {
  stubFetch(() => ok({ embeddings: [{ values: rawVector() }] }));

  await embedDocuments(['How the waitlist works']);

  const { url, body } = calls[0];
  assert.match(url, /batchEmbedContents$/);
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0].model, `models/${EMBEDDING_MODEL}`);
  assert.equal(body.requests[0].taskType, 'RETRIEVAL_DOCUMENT');
  assert.equal(body.requests[0].outputDimensionality, EMBEDDING_DIM);
}));

test('a query request uses the QUERY task type, not the document one', withKey(async () => {
  stubFetch(() => ok({ embedding: { values: rawVector() } }));

  await embedQuery('can I be told when a slot frees up?');

  const { url, body } = calls[0];
  assert.match(url, /embedContent$/);
  // The asymmetry is the point: measured cosine between a DOCUMENT and a QUERY
  // embedding of the same text is 0.827, not 1.0. Matching them up would look
  // tidier and retrieve worse.
  assert.equal(body.taskType, 'RETRIEVAL_QUERY');
}));

test('a batch is ONE call, not one call per document', withKey(async () => {
  stubFetch(() => ok({ embeddings: [1, 2, 3].map(() => ({ values: rawVector() })) }));

  const vectors = await embedDocuments(['a', 'b', 'c']);

  assert.equal(calls.length, 1, 'the batch endpoint exists to avoid N calls');
  assert.equal(vectors.length, 3);
}));

test('an empty batch makes no call at all', withKey(async () => {
  stubFetch(() => ok({ embeddings: [] }));

  assert.deepEqual(await embedDocuments([]), []);
  assert.equal(calls.length, 0);
}));

// --- the trap ---------------------------------------------------------------

test('vectors come back UNIT-LENGTH even though the API output is not', withKey(async () => {
  const raw = rawVector();
  assert.ok(
    Math.abs(magnitude(raw) - 1) > 0.01,
    'the fixture must be non-unit or this test proves nothing',
  );

  stubFetch(() => ok({ embeddings: [{ values: raw }] }));
  const [vector] = await embedDocuments(['x']);

  // The real 768 output measured 0.591345. Storing that un-normalised would
  // leave 8.3 free to use a dot product, which would then rank by magnitude as
  // much as by meaning — and silently.
  assert.ok(
    Math.abs(magnitude(vector) - 1) < 1e-9,
    `expected a unit vector, got magnitude ${magnitude(vector)}`,
  );
}));

test('normalising preserves direction, so ranking is unchanged', withKey(async () => {
  const raw = rawVector();
  stubFetch(() => ok({ embeddings: [{ values: raw }] }));

  const [vector] = await embedDocuments(['x']);

  // Every component scaled by the same factor: normalisation must not be
  // rewriting the vector's meaning, only its length.
  const ratios = vector.map((x, i) => x / raw[i]);
  const first = ratios[0];
  for (const ratio of ratios) {
    assert.ok(Math.abs(ratio - first) < 1e-9, 'components were scaled unevenly');
  }
}));

test('a query vector is normalised too', withKey(async () => {
  stubFetch(() => ok({ embedding: { values: rawVector() } }));

  const vector = await embedQuery('x');
  assert.ok(Math.abs(magnitude(vector) - 1) < 1e-9);
}));

// --- failure ----------------------------------------------------------------

test('a 429 is retried rather than thrown', withKey(async () => {
  process.env.GEMINI_RETRY_BASE_MS = '1';
  stubFetch((n) =>
    n === 1 ? fail(429) : ok({ embeddings: [{ values: rawVector() }] }),
  );

  const vectors = await embedDocuments(['x']);

  assert.equal(calls.length, 2, 'the 429 should have been retried');
  assert.equal(vectors.length, 1);
  delete process.env.GEMINI_RETRY_BASE_MS;
}));

test('a 400 is NOT retried — it is a bug, and retrying delays the diagnosis', withKey(async () => {
  stubFetch(() => fail(400, '{"error":"bad request"}'));

  await assert.rejects(embedDocuments(['x']), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(calls.length, 1);
}));

test('the API key never reaches the error message', withKey(async () => {
  const key = process.env.GEMINI_API_KEY;
  // Provider error bodies sometimes echo the request.
  stubFetch(() => fail(400, `{"error":"bad key ${key}"}`));

  await assert.rejects(embedDocuments(['x']), (error) => {
    assert.ok(!error.message.includes(key), 'the key leaked into the error');
    assert.match(error.message, /REDACTED/);
    return true;
  });
}));

test('a short batch response is refused rather than silently misaligned', withKey(async () => {
  // Results are zipped back onto documents by POSITION, so a response with the
  // wrong count would attach vectors to the wrong passages — retrieval would
  // then confidently return the wrong text.
  stubFetch(() => ok({ embeddings: [{ values: rawVector() }] }));

  await assert.rejects(embedDocuments(['a', 'b', 'c']), /Asked for 3 embeddings/);
}));

test('a missing key fails before any request is made', async () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  stubFetch(() => ok({ embeddings: [] }));

  try {
    await assert.rejects(embedDocuments(['x']), /GEMINI_API_KEY is not set/);
    assert.equal(calls.length, 0);
  } finally {
    if (previous !== undefined) process.env.GEMINI_API_KEY = previous;
  }
});

// --- the real contract, opt-in ----------------------------------------------

// The stubs above encode what the API is believed to do. This is what keeps
// that belief honest — the same opt-in shape dbPool.test.js uses for its
// container tests, so `npm test` stays offline and free.
const liveSkip = process.env.EMBEDDINGS_LIVE_TEST
  ? false
  : 'set EMBEDDINGS_LIVE_TEST=1 to call the real embedding API';

test('LIVE: the real API returns the dimension we ask for', { skip: liveSkip }, async () => {
  const [vector] = await embedDocuments(['How does the waitlist work?']);

  assert.equal(vector.length, EMBEDDING_DIM);
  assert.ok(Math.abs(magnitude(vector) - 1) < 1e-6, 'not normalised after our pass');
});

test('LIVE: a query embeds to the same shape as a document', { skip: liveSkip }, async () => {
  const query = await embedQuery('can I be told when a slot frees up?');
  const [doc] = await embedDocuments(['What is the waitlist and how does it work?']);

  assert.equal(query.length, doc.length);

  // Both are unit vectors, so the dot product IS the cosine — which is exactly
  // the shortcut 8.3 gets to take because normalisation happened at write time.
  const cosine = query.reduce((sum, x, i) => sum + x * doc[i], 0);
  assert.ok(cosine > 0.3, `related texts scored only ${cosine}`);
  assert.ok(cosine <= 1.000001, `cosine above 1 means the vectors are not unit-length: ${cosine}`);
});
