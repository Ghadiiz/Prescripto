import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { closeRedis } from '../src/config/redis.js';
import { readFileSync } from 'node:fs';

import { emergencyCheck } from '../src/assistant/guardrails/emergencyCheck.js';
import {
  PHYSICAL_EMERGENCY_PHRASES,
  SELF_HARM_PHRASES,
  PHYSICAL_EMERGENCY_RESPONSE,
  SELF_HARM_RESPONSE,
} from '../src/assistant/guardrails/emergencyPhrases.js';
import { connectDB, getDB } from '../src/config/mysql.js';
import { runConversation } from '../src/assistant/agentLoop.js';

const TEST_SESSION_ID = 'eeeeeeee-2222-3333-4444-555555555555';
const realFetch = globalThis.fetch;

let db;
let ctx;

before(async () => {
  const dbHost = process.env.DB_HOST || '';
  if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
    throw new Error(
      'Refusing to run tests: DB_HOST is "' + dbHost + '", not localhost.',
    );
  }

  process.env.GEMINI_API_KEY = 'test-key-do-not-use';
  await connectDB();
  db = getDB();

  const [[patient]] = await db.query(
    "SELECT id FROM users WHERE role = 'patient' ORDER BY id LIMIT 1",
  );
  ctx = { userId: patient.id, role: 'patient' };
});

after(async () => {
  await db.end();
  await closeRedis();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await db.query('DELETE FROM assistant_audit_log WHERE session_id = ?', [
    TEST_SESSION_ID,
  ]);
});

test('every listed phrase trips the check', () => {
  // Asserted over the whole list, not a sample: a phrase added later is
  // covered automatically, and one that cannot match its own text fails here.
  for (const phrase of [...PHYSICAL_EMERGENCY_PHRASES, ...SELF_HARM_PHRASES]) {
    const result = emergencyCheck(`something something ${phrase} something`);
    assert.ok(result.tripped, `"${phrase}" did not trip the check`);
  }
});

test('a phrase inside a real sentence trips', () => {
  const messages = [
    'I think my dad is having a heart attack, what do I do',
    'my daughter is choking!!',
    'he collapsed and is unresponsive',
    'I took too many pills, I think I overdosed',
    "I don't want to be here anymore, I want to die",
  ];

  for (const message of messages) {
    assert.ok(emergencyCheck(message).tripped, `missed: ${message}`);
  }
});

test('contractions and spacing variants all trip', () => {
  for (const variant of [
    "I can't breathe",
    'I cant breathe',
    'I cannot breathe',
    'I  CAN’T   BREATHE',
  ]) {
    assert.ok(emergencyCheck(variant).tripped, `missed: ${variant}`);
  }
});

test('inflected forms trip — the list is recall-favouring', () => {
  // Emergency detection has the opposite cost structure from speciality
  // routing: a missed "he's having strokes" means a booking assistant answers
  // a medical crisis, while a false positive costs one recoverable turn. So
  // plurals and tense variants must all trip.
  const inflected = [
    'my father is having strokes',
    'he has had heart attacks before',
    'I think he is overdosing',
    'she keeps passing out',
    'he is seizing',
    'my waters broke',
    'she isnt breathing',
    "she isn't breathing",
    'he is not responding',
    'I keep hurting myself',
  ];

  for (const message of inflected) {
    assert.ok(emergencyCheck(message).tripped, `missed: ${message}`);
  }
});

test('word boundaries hold — near-misses must NOT trip', () => {
  // Substring matching would fire on every one of these. Adding plurals is
  // adding tokens, not loosening to substring matching: "strokes" must still
  // not fire inside a longer single word.
  const safe = [
    'the view was breathtaking',
    'I unconsciously booked the wrong day',
    'I am painting my clinic',
    'my class is about to start',
    'I need a therapist for stress',
    'I swim backstrokes for exercise',
    'the clinic overstrokes its billing',
  ];

  for (const message of safe) {
    const result = emergencyCheck(message);
    assert.equal(
      result.tripped,
      false,
      `false positive on "${message}" (matched ${result.matched.join(', ')})`,
    );
  }
});

test('ordinary booking questions never trip', () => {
  const ordinary = [
    'I need a dermatologist',
    'my back hurts, who should I see',
    'I have a rash on my arm',
    'book me a checkup next week',
    'what are your opening hours',
    'show me my appointments',
    'is Dr Sarah Patel available on Thursday',
    'I need a vaccination for my baby',
  ];

  for (const message of ordinary) {
    const result = emergencyCheck(message);
    assert.equal(
      result.tripped,
      false,
      `false positive on "${message}" (matched ${result.matched.join(', ')})`,
    );
  }
});

test('the physical response is fixed, names 911, and offers a way to continue', () => {
  const { response, category } = emergencyCheck('chest pain');

  assert.equal(category, 'physical');
  assert.equal(response, PHYSICAL_EMERGENCY_RESPONSE, 'must be returned verbatim');
  assert.match(response, /911/);
  assert.match(response, /emergency department/i);
  assert.match(
    response,
    /if this is not an emergency/i,
    'a false positive must not dead-end the conversation',
  );
});

test('the phrase list cannot be reached from the database', () => {
  // If these lived in a table, anyone with admin access could empty it and
  // silently disable the check.
  for (const file of ['emergencyPhrases.js', 'emergencyCheck.js']) {
    const source = readFileSync(
      new URL(`../src/assistant/guardrails/${file}`, import.meta.url),
      'utf8',
    );
    assert.ok(!source.includes('mysql'), `${file} must not touch the database`);
    assert.ok(!source.includes('models/'), `${file} must not query models`);
    assert.ok(!source.includes('getDB'), `${file} must not open a connection`);
  }
});

test('a tripping message reaches NO provider call and NO audit row', async () => {
  // Any provider call at all is a failure: the model must never see this.
  globalThis.fetch = async () => {
    throw new Error('the provider must not be called on an emergency');
  };

  const result = await runConversation({
    ctx,
    sessionId: TEST_SESSION_ID,
    system: 'test system prompt',
    messages: [{ role: 'user', content: 'my father is having chest pain' }],
  });

  assert.equal(result.stoppedReason, 'emergency');
  assert.equal(result.text, PHYSICAL_EMERGENCY_RESPONSE);
  assert.equal(result.toolCallsMade, 0);
  assert.equal(result.iterations, 0);

  const [rows] = await db.query(
    'SELECT id FROM assistant_audit_log WHERE session_id = ?',
    [TEST_SESSION_ID],
  );
  assert.equal(rows.length, 0, 'nothing ran, so nothing should be logged');
});

test('the check reads the latest user message, not an earlier one', async () => {
  globalThis.fetch = async () => {
    throw new Error('the provider must not be called on an emergency');
  };

  const result = await runConversation({
    ctx,
    sessionId: TEST_SESSION_ID,
    system: 'test system prompt',
    messages: [
      { role: 'user', content: 'I need a dermatologist' },
      { role: 'assistant', content: 'Sure, here are some options.' },
      { role: 'user', content: 'actually he is unconscious now' },
    ],
  });

  assert.equal(result.stoppedReason, 'emergency');
});

test('self-harm phrasing gets its own response, not the physical one', () => {
  for (const message of [
    'I wanna die',
    "I've been harming myself",
    'I keep hurting myself',
    'I have been thinking about suicide',
    'I want to end it all',
    'I dont want to be here anymore',
  ]) {
    const result = emergencyCheck(message);

    assert.equal(result.tripped, true, `missed: ${message}`);
    assert.equal(result.category, 'self_harm', `wrong category: ${message}`);
    assert.equal(result.response, SELF_HARM_RESPONSE);
    assert.notEqual(
      result.response,
      PHYSICAL_EMERGENCY_RESPONSE,
      'telling someone in crisis to visit A&E reads as a brush-off',
    );
  }
});

test('the self-harm response acknowledges, points to help, and keeps the door open', () => {
  const { response } = emergencyCheck('I want to die');

  assert.match(response, /really sorry you.re feeling this way/i);
  assert.match(response, /911/, 'immediate danger still needs the number');
  assert.match(response, /crisis line|mental health professional/i);
  assert.match(
    response,
    /help you find a doctor/i,
    'the conversation must not dead-end',
  );
  // A wrong crisis-line number is worse than none, so only 911 is named.
  const numbers = response.match(/\b\d{3,}\b/g) ?? [];
  assert.deepEqual(numbers, ['911'], 'no other phone number may appear');
});

test('when both categories trip, self-harm wins', () => {
  // Its response already names 911, so nothing is lost; the reverse would
  // answer a crisis with "go to your nearest emergency department".
  const result = emergencyCheck(
    'I have chest pain and I want to kill myself',
  );

  assert.equal(result.category, 'self_harm');
  assert.equal(result.response, SELF_HARM_RESPONSE);
  assert.ok(
    result.matched.includes('chest pain'),
    'the physical match is still reported',
  );
  assert.ok(result.matched.includes('kill myself'));
});

test('self-harm phrasing reaches NO provider call and NO audit row', async () => {
  globalThis.fetch = async () => {
    throw new Error('the provider must not be called on a crisis message');
  };

  const result = await runConversation({
    ctx,
    sessionId: TEST_SESSION_ID,
    system: 'test system prompt',
    messages: [{ role: 'user', content: "I've been harming myself lately" }],
  });

  assert.equal(result.stoppedReason, 'emergency');
  assert.equal(result.text, SELF_HARM_RESPONSE);
  assert.equal(result.toolCallsMade, 0);
  assert.equal(result.iterations, 0);

  const [rows] = await db.query(
    'SELECT id FROM assistant_audit_log WHERE session_id = ?',
    [TEST_SESSION_ID],
  );
  assert.equal(rows.length, 0);
});

test('the two responses are genuinely different strings', () => {
  assert.notEqual(PHYSICAL_EMERGENCY_RESPONSE, SELF_HARM_RESPONSE);
  assert.ok(
    !SELF_HARM_RESPONSE.includes('nearest emergency department'),
    'the crisis response must not lead with A&E',
  );
});
