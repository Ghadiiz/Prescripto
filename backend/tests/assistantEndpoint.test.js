import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

import { connectDB, getDB } from '../src/config/mysql.js';
import assistantRoutes from '../src/assistant/assistantRoutes.js';
import {
  resetRateLimits,
  MAX_REQUESTS_PER_HOUR,
} from '../src/assistant/rateLimit.js';
import { resetBudget, getBudget } from '../src/assistant/agentService.js';
import {
  PHYSICAL_EMERGENCY_RESPONSE,
  SELF_HARM_RESPONSE,
} from '../src/assistant/guardrails/emergencyPhrases.js';
import { OUT_OF_SCOPE_RESPONSE } from '../src/assistant/guardrails/scopePhrases.js';

// The endpoint is exercised over a REAL HTTP server on an ephemeral port
// rather than through a mock request object. SSE is the thing under test:
// headers, event framing, ordering, and the close. A fake `res` would let us
// assert on a shape no browser would ever receive.
//
// Only the provider is stubbed. Tools run against the real database, so the
// same localhost guard as the other suites applies.

const realFetch = globalThis.fetch;

// A user id that deliberately does not exist, used to show the rate limiter
// keys on the user and not the IP. A function because patientId is not known
// until before() runs.
const otherUserId = () => patientId + 12345;

let db;
let server;
let baseUrl;
let patientId;
let doctorId;
let providerCalls;

// --- provider stubbing ------------------------------------------------------

// One Gemini SSE frame per chunk. A real Response is used so `body.getReader()`
// is a real web stream — the same thing agentService reads from the live API.
const sseResponse = (chunks) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

const textChunk = (text) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
});

const toolChunk = (name, args) => ({
  candidates: [
    { content: { parts: [{ functionCall: { name, args, id: 'call_1' } }] } },
  ],
});

// Intercepts provider traffic only; requests to our own test server pass
// through untouched.
const stubProvider = (handler) => {
  providerCalls = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes('generativelanguage')) {
      return realFetch(url, options);
    }

    providerCalls.push(JSON.parse(options.body));
    return handler(providerCalls.length, options);
  };
};

// A provider stub that fails loudly. Every test using it asserts the model was
// never consulted.
const forbidProvider = () =>
  stubProvider(() => {
    throw new Error('the provider must not be called');
  });

// --- SSE client -------------------------------------------------------------

const tokenFor = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });

// Reads a complete SSE response into { event, data } records.
const parseEvents = (raw) =>
  raw
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      return { event, data: data ? JSON.parse(data) : null };
    });

const chat = async (token, body, init = {}) => {
  const response = await realFetch(`${baseUrl}/api/assistant/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    ...init,
  });

  const raw = await response.text();
  const isStream = response.headers
    .get('content-type')
    ?.includes('text/event-stream');
  const events = isStream ? parseEvents(raw) : [];

  return {
    status: response.status,
    headers: response.headers,
    events,
    json: isStream ? null : JSON.parse(raw),
    // Everything the user would actually see.
    text: events
      .filter((e) => e.event === 'token')
      .map((e) => e.data.delta)
      .join(''),
  };
};

// --- setup ------------------------------------------------------------------

before(async () => {
  const dbHost = process.env.DB_HOST || '';
  if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
    throw new Error(
      'Refusing to run tests: DB_HOST is "' +
        dbHost +
        '", not localhost. ' +
        'These tests execute tools against a real database.',
    );
  }

  process.env.GEMINI_API_KEY = 'test-key-do-not-use';

  await connectDB();
  db = getDB();

  const [[patient]] = await db.query(
    "SELECT id FROM users WHERE role = 'patient' ORDER BY id LIMIT 1",
  );
  const [[doctorUser]] = await db.query(
    "SELECT id FROM users WHERE role = 'doctor' ORDER BY id LIMIT 1",
  );

  patientId = patient.id;
  doctorId = doctorUser?.id ?? patient.id;

  // The real mounting, minus the rest of the app: same router, same
  // middleware, same JSON parser.
  const app = express();
  app.use(express.json());
  app.use('/api/assistant', assistantRoutes);

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.end();
});

const cleanup = async () => {
  resetRateLimits();
  resetBudget();

  // otherUserId() included deliberately: the rate-limit test signs a token for
  // a user id that does not exist, purely to show the limiter keys on the user
  // rather than the IP. That turn still writes a conversation row, and without
  // this the row outlives the run — orphaned history for a phantom patient.
  const ids = [patientId, doctorId, otherUserId()];

  await db.query('DELETE FROM conversations WHERE user_id IN (?)', [ids]);
  await db.query('DELETE FROM assistant_audit_log WHERE user_id IN (?)', [ids]);
};

beforeEach(cleanup);
afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_DAILY_CALL_CAP;
  await cleanup();
});

// --- 1. the door ------------------------------------------------------------

test('an unauthenticated request is refused and never reaches the provider', async () => {
  forbidProvider();

  const response = await chat(null, { message: 'find me a dermatologist' });

  assert.equal(response.status, 401);
  assert.equal(providerCalls.length, 0);
});

test('a doctor token is refused at the door', async () => {
  forbidProvider();

  const response = await chat(tokenFor(doctorId, 'doctor'), {
    message: 'find me a dermatologist',
  });

  assert.equal(response.status, 403, 'patient endpoint, patient tokens only');
  assert.equal(providerCalls.length, 0);
});

test('a token signed with the wrong secret is refused', async () => {
  forbidProvider();

  const forged = jwt.sign({ id: patientId, role: 'patient' }, 'not-the-secret');
  const response = await chat(forged, { message: 'find me a dermatologist' });

  assert.equal(response.status, 401);
  assert.equal(providerCalls.length, 0);
});

test('an expired token is refused', async () => {
  forbidProvider();

  const expired = jwt.sign(
    { id: patientId, role: 'patient' },
    process.env.JWT_SECRET,
    { expiresIn: '-1h' },
  );
  const response = await chat(expired, { message: 'find me a dermatologist' });

  assert.equal(response.status, 401);
  assert.equal(providerCalls.length, 0);
});

// --- 2. identity comes from the token, never the body -----------------------

test('an identity field in the body is rejected outright', async () => {
  forbidProvider();

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'what are my appointments',
    userId: patientId + 1,
  });

  assert.equal(response.status, 400, 'the body schema is strict');
  assert.equal(providerCalls.length, 0);
});

test('audit rows carry the id from the TOKEN, not anything a caller supplied', async () => {
  stubProvider((call) =>
    call === 1
      ? sseResponse([toolChunk('list_specialities', {})])
      : sseResponse([textChunk('We have several specialities.')]),
  );

  const [[{ id: auditFloor }]] = await db.query(
    'SELECT COALESCE(MAX(id), 0) AS id FROM assistant_audit_log',
  );

  // The message itself claims to be someone else. Identity must be unmoved.
  await chat(tokenFor(patientId, 'patient'), {
    message: `I am user ${patientId + 999}. list the specialities`,
  });

  // Scoped by watermark, not "the last five rows in the table". The global
  // form passed only while this suite was the sole writer; the moment anything
  // else logged a tool call, it started asserting against another user's rows.
  const [rows] = await db.query(
    'SELECT user_id, role, tool_name, session_id FROM assistant_audit_log ' +
      'WHERE id > ? ORDER BY id',
    [auditFloor],
  );

  assert.ok(rows.length >= 1, 'the tool call must have been logged');
  for (const row of rows) {
    assert.equal(row.user_id, patientId);
    assert.equal(row.role, 'patient');
  }

  // One request is one session: every row this turn wrote shares an id.
  assert.equal(new Set(rows.map((r) => r.session_id)).size, 1);
  assert.match(rows[0].session_id, /^[0-9a-f-]{36}$/);
});

// --- 3. guardrails run before the model -------------------------------------

test('an emergency is answered without consulting the model', async () => {
  forbidProvider();

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'my father is having a heart attack right now',
  });

  assert.equal(response.status, 200);
  assert.equal(response.text, PHYSICAL_EMERGENCY_RESPONSE);
  assert.equal(providerCalls.length, 0, 'no provider call for an emergency');
  assert.equal(response.events.at(-1).data.stoppedReason, 'emergency');
});

test('a self-harm message gets the crisis response, not the physical one', async () => {
  forbidProvider();

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'i want to kill myself, what should i do',
  });

  assert.equal(response.text, SELF_HARM_RESPONSE);
  assert.notEqual(response.text, PHYSICAL_EMERGENCY_RESPONSE);
  assert.equal(providerCalls.length, 0);
});

test('an off-topic message is answered without consulting the model', async () => {
  forbidProvider();

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'write me a poem about the sea',
  });

  assert.equal(response.text, OUT_OF_SCOPE_RESPONSE);
  assert.equal(providerCalls.length, 0);
  assert.equal(response.events.at(-1).data.stoppedReason, 'out_of_scope');
});

// --- 4. rate limiting, keyed on the user ------------------------------------

test('the budget is per user and per hour, and a refusal costs no provider call', async () => {
  stubProvider(() => sseResponse([textChunk('Here are some doctors.')]));

  const token = tokenFor(patientId, 'patient');

  for (let i = 1; i <= MAX_REQUESTS_PER_HOUR; i += 1) {
    const allowed = await chat(token, { message: 'find me a dermatologist' });
    assert.equal(allowed.text, 'Here are some doctors.', `request ${i}`);
  }

  const callsBefore = providerCalls.length;
  const refused = await chat(token, { message: 'find me a dermatologist' });

  assert.match(refused.text, /limit of 5 assistant messages per hour/);
  assert.equal(refused.events.at(-1).data.stoppedReason, 'rate_limited');
  assert.ok(
    refused.headers.get('retry-after'),
    'the client is told when to come back',
  );
  assert.equal(
    providerCalls.length,
    callsBefore,
    'a rate-limited turn must not spend a provider call',
  );

  // A different user is unaffected — the key is the user, not the IP, and
  // every request in this test comes from the same address.
  const other = await chat(tokenFor(otherUserId(), 'patient'), {
    message: 'find me a dermatologist',
  });
  assert.equal(other.text, 'Here are some doctors.');
});

// --- 5. SSE shape -----------------------------------------------------------

test('status precedes tool execution and carries the tool name only', async () => {
  stubProvider((call) =>
    call === 1
      ? sseResponse([
          toolChunk('search_doctors', { speciality: 'Dermatologist' }),
        ])
      : sseResponse([textChunk('Found some.')]),
  );

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'find me a dermatologist',
  });

  const statuses = response.events.filter((e) => e.event === 'status');
  assert.equal(statuses.length, 1);
  assert.deepEqual(statuses[0].data, { tool: 'search_doctors' });

  // The whole point of the status event: it lands before the round it
  // announces has produced anything.
  const statusIndex = response.events.findIndex((e) => e.event === 'status');
  const finalTokenIndex = response.events.findLastIndex(
    (e) => e.event === 'token',
  );
  assert.ok(statusIndex < finalTokenIndex, 'status arrives before the answer');

  // Scoped to the STATUS event, which is what this test is about. It used to
  // assert that nothing tool-shaped appeared anywhere on the wire — true only
  // while no structured data was ever intended. 3.2 sends doctor fields
  // deliberately, through an allowlist, so the blanket claim would now fail
  // for the right reason. The precise property it stood in for — arguments
  // stay server-side — is asserted on cards below and in clientCards.test.js.
  //
  // Two layers still enforce it: the loop puts only a name in the event, and
  // the controller narrows again on the way out.
  const statusWire = JSON.stringify(statuses);
  assert.ok(!statusWire.includes('Dermatologist'), 'no tool ARGUMENTS in status');
  assert.ok(!statusWire.includes('speciality'), 'no argument names either');

  assert.equal(response.events.at(-1).event, 'done');
  assert.equal(response.events.at(-1).data.toolCallsMade, 1);
});

test('assistant text arrives as incremental token events, not one lump', async () => {
  stubProvider(() =>
    sseResponse([
      textChunk('Dr. Ava '),
      textChunk('Mitchell is '),
      textChunk('available.'),
    ]),
  );

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'find me a dermatologist',
  });

  const tokens = response.events.filter((e) => e.event === 'token');
  assert.equal(tokens.length, 3, 'each provider chunk is forwarded as it lands');
  assert.equal(response.text, 'Dr. Ava Mitchell is available.');
});

test('the response is streamed, not buffered by a proxy', async () => {
  stubProvider(() => sseResponse([textChunk('Here are some doctors.')]));

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'find me a dermatologist',
  });

  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
});

// --- 6. failure is explicit -------------------------------------------------

test('a provider failure closes with an error event rather than hanging', async () => {
  stubProvider(() => new Response('upstream exploded', { status: 500 }));

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'find me a dermatologist',
  });

  const error = response.events.find((e) => e.event === 'error');
  assert.ok(error, 'the client is told the turn failed');
  assert.match(error.data.message, /went wrong/);

  // Nothing about the provider, the status, or the upstream body leaks.
  const wire = JSON.stringify(response.events).toLowerCase();
  for (const forbidden of [
    'upstream exploded',
    'generativelanguage',
    'gemini',
    '500',
  ]) {
    assert.ok(
      !wire.includes(forbidden.toLowerCase()),
      `"${forbidden}" must not reach the client`,
    );
  }

  // And a failed turn is not remembered as if it had happened.
  const [rows] = await db.query(
    'SELECT id FROM conversations WHERE user_id = ? AND role = ?',
    [patientId, 'patient'],
  );
  assert.equal(rows.length, 0);
});

// --- 7 & 8. persistence -----------------------------------------------------

test('a completed turn is persisted as exactly the question and the answer', async () => {
  stubProvider((call) =>
    call === 1
      ? sseResponse([toolChunk('list_specialities', {})])
      : sseResponse([textChunk('We have several specialities.')]),
  );

  const token = tokenFor(patientId, 'patient');
  await chat(token, { message: 'what specialities do you have' });

  const [rows] = await db.query(
    'SELECT messages FROM conversations WHERE user_id = ? AND role = ?',
    [patientId, 'patient'],
  );

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].messages, [
    { role: 'user', content: 'what specialities do you have' },
    { role: 'assistant', content: 'We have several specialities.' },
  ]);

  // The next turn replays it: the stored exchange really is used as context.
  stubProvider(() => sseResponse([textChunk('Dermatology, for one.')]));
  await chat(token, { message: 'which of those treats skin' });

  const sent = JSON.stringify(providerCalls[0].contents);
  assert.ok(
    sent.includes('what specialities do you have'),
    'history is replayed',
  );
  assert.ok(sent.includes('We have several specialities.'));
});

test('an abandoned turn is not saved as history', async () => {
  // The client hangs up mid-turn. A truncated sentence replayed later would be
  // read by the model as something it actually finished saying.
  stubProvider(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return sseResponse([textChunk('a sentence that never arriv')]);
  });

  const controller = new AbortController();
  const pending = chat(
    tokenFor(patientId, 'patient'),
    { message: 'find me a dermatologist' },
    { signal: controller.signal },
  );

  setTimeout(() => controller.abort(), 60);
  await assert.rejects(pending, /abort/i);

  // Give the server a moment to finish reacting to the disconnect.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const [rows] = await db.query(
    'SELECT id FROM conversations WHERE user_id = ? AND role = ?',
    [patientId, 'patient'],
  );
  assert.equal(rows.length, 0, 'an aborted turn leaves no history');
});

// --- 9. running out of free-tier budget -------------------------------------

// Spends the daily allowance without needing 50 real calls.
const exhaustBudget = async () => {
  process.env.GEMINI_DAILY_CALL_CAP = '1';
  stubProvider(() => sseResponse([textChunk('first and last.')]));
  await chat(tokenFor(patientId, 'patient'), {
    message: 'find me a dermatologist',
  });
  assert.equal(getBudget().remaining, 0, 'precondition: the budget is spent');
};

test('at capacity the patient gets a friendly message, not an error', async () => {
  await exhaustBudget();

  const callsBefore = providerCalls.length;
  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'find me a cardiologist',
  });

  assert.equal(response.status, 200, 'not an error status');
  assert.match(response.text, /limit of requests for today/);
  assert.match(response.text, /browse doctors and book appointments/);
  assert.equal(response.events.at(-1).data.stoppedReason, 'at_capacity');
  assert.equal(
    providerCalls.length,
    callsBefore,
    'we stop ourselves rather than making Google refuse us',
  );

  // No error event, and nothing provider-shaped on the wire.
  assert.equal(response.events.filter((e) => e.event === 'error').length, 0);
  const wire = JSON.stringify(response.events).toLowerCase();
  for (const forbidden of ['gemini', 'quota', '429', 'model']) {
    assert.ok(!wire.includes(forbidden), `"${forbidden}" must not be shown`);
  }
});

test('at capacity, an emergency STILL gets the emergency response', async () => {
  await exhaustBudget();

  // The capacity check is deliberately the last gate. The emergency response
  // needs no provider call, so no budget state may suppress it.
  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'my father is having a heart attack right now',
  });

  assert.equal(response.text, PHYSICAL_EMERGENCY_RESPONSE);
  assert.equal(response.events.at(-1).data.stoppedReason, 'emergency');
});

test('the cap tripping mid-turn appends the message and saves no history', async () => {
  // Two calls available, and a turn that wants three: one tool round, then the
  // budget runs out before the model can answer.
  process.env.GEMINI_DAILY_CALL_CAP = '2';
  stubProvider((call) =>
    call === 1
      ? sseResponse([toolChunk('list_specialities', {})])
      : sseResponse([toolChunk('search_doctors', { speciality: 'Dermatologist' })]),
  );

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'what specialities do you have',
  });

  assert.match(response.text, /limit of requests for today/);
  assert.equal(response.events.at(-1).data.stoppedReason, 'at_capacity');
  assert.equal(response.events.filter((e) => e.event === 'error').length, 0);

  // An unfinished turn is not a turn — the same rule the abort path follows.
  const [rows] = await db.query(
    'SELECT id FROM conversations WHERE user_id = ? AND role = ?',
    [patientId, 'patient'],
  );
  assert.equal(rows.length, 0, 'a turn cut short must not become history');
});

// --- 10. structured cards on the wire ---------------------------------------

test('a doctor search emits a card of database fields, never the arguments', async () => {
  stubProvider((call) =>
    call === 1
      ? sseResponse([
          toolChunk('search_doctors', { speciality: 'Dermatologist' }),
        ])
      : sseResponse([textChunk('I found a few.')]),
  );

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'find me a dermatologist',
  });

  const cards = response.events.filter((e) => e.event === 'card');
  assert.equal(cards.length, 1, 'one card per tool result that has one');
  assert.equal(cards[0].data.kind, 'doctors');
  assert.ok(cards[0].data.doctors.length >= 1);

  // Real rows from the database, not an echo of what the model asked for.
  const [doctor] = cards[0].data.doctors;
  assert.equal(typeof doctor.id, 'number');
  assert.equal(typeof doctor.name, 'string');
  assert.match(doctor.mapsUrl, /^https:\/\/www\.google\.com\/maps/);

  // The allowlist shape, asserted where it actually crosses to a browser.
  assert.deepEqual(Object.keys(doctor).sort(), [
    'addressLine1',
    'addressLine2',
    'area',
    'degree',
    'experienceYears',
    'fees',
    'gender',
    'id',
    'image',
    'languages',
    'mapsUrl',
    'name',
    'speciality',
  ]);

  const wire = JSON.stringify(response.events);
  assert.ok(!wire.includes('_unverified'), 'prompt plumbing stays server-side');
  assert.ok(!wire.includes('about'), 'the injectable free-text field never ships');
});

test('an availability card always carries the time it was checked', async () => {
  const [[doctor]] = await db.query(
    'SELECT id FROM doctors WHERE available = 1 ORDER BY id LIMIT 1',
  );

  stubProvider((call) =>
    call === 1
      ? sseResponse([
          toolChunk('check_availability', {
            doctor_id: doctor.id,
            date: '2031-03-04',
          }),
        ])
      : sseResponse([textChunk('There is room that day.')]),
  );

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'is that doctor free',
  });

  const [card] = response.events.filter((e) => e.event === 'card');
  assert.equal(card.data.kind, 'availability');

  // Rule 7. A slot count that reaches the UI without the moment it was true
  // is a promise, and the UI would have nothing to caveat it with.
  assert.ok(card.data.checkedAt, 'checkedAt must ship with the counts');
  assert.ok(
    !Number.isNaN(Date.parse(card.data.checkedAt)),
    'and must be a real timestamp the browser can format',
  );
  assert.equal(typeof card.data.dates[0].freeSlotCount, 'number');
});

test('tools with no card projection put nothing on the wire', async () => {
  stubProvider((call) =>
    call === 1
      ? sseResponse([toolChunk('list_specialities', {})])
      : sseResponse([textChunk('We cover six areas.')]),
  );

  const response = await chat(tokenFor(patientId, 'patient'), {
    message: 'what specialities do you have',
  });

  // The tool ran — this is the fail-closed default, not an absent call.
  assert.equal(
    response.events.filter((e) => e.event === 'status').length,
    1,
    'precondition: the tool really did run',
  );
  assert.equal(
    response.events.filter((e) => e.event === 'card').length,
    0,
    'a tool without a projection is silent',
  );
});
