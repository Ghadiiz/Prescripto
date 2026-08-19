import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { scopeCheck } from '../src/assistant/guardrails/scopeCheck.js';
import {
  OFF_TOPIC_PHRASES,
  MEDICAL_ADVICE_PHRASES,
  OUT_OF_SCOPE_RESPONSE,
} from '../src/assistant/guardrails/scopePhrases.js';
import {
  PHYSICAL_EMERGENCY_RESPONSE,
  SELF_HARM_RESPONSE,
} from '../src/assistant/guardrails/emergencyPhrases.js';
import { connectDB, getDB } from '../src/config/mysql.js';
import { runConversation } from '../src/assistant/agentLoop.js';

const TEST_SESSION_ID = 'cafecafe-2222-3333-4444-555555555555';
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
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await db.query('DELETE FROM assistant_audit_log WHERE session_id = ?', [
    TEST_SESSION_ID,
  ]);
});

const noProvider = () => {
  globalThis.fetch = async () => {
    throw new Error('the provider must not be called when the gate trips');
  };
};

test('every listed phrase trips the gate', () => {
  for (const phrase of [...OFF_TOPIC_PHRASES, ...MEDICAL_ADVICE_PHRASES]) {
    const result = scopeCheck(`hello ${phrase} please`);
    assert.equal(result.inScope, false, `"${phrase}" did not trip`);
  }
});

test('off-topic requests are declined', () => {
  for (const message of [
    'write me a poem about doctors',
    'tell me a joke',
    "what's the weather tomorrow",
    'can you do my homework',
    'write a function that sorts an array',
    'who won the world cup',
  ]) {
    const result = scopeCheck(message);
    assert.equal(result.inScope, false, `missed: ${message}`);
    assert.equal(result.category, 'off_topic');
  }
});

test('unmistakable medical-advice phrasings are declined', () => {
  for (const message of [
    'what should i take for this rash',
    "what's wrong with me",
    'can you diagnose me',
    'can you prescribe me something',
    'do i need antibiotics for this',
    'what dosage of paracetamol',
  ]) {
    const result = scopeCheck(message);
    assert.equal(result.inScope, false, `missed: ${message}`);
    assert.equal(result.category, 'medical_advice');
  }
});

// The assertion that matters most: a false positive here breaks the product.
test('booking questions ALWAYS pass, including off-topic-word traps', () => {
  const mustPass = [
    // An off-topic WORD inside a booking INTENT.
    'Do you have a doctor near the weather station?',
    'Write down which doctors treat skin problems',
    'I need a doctor urgently for my grandmother',
    // Ordinary booking questions.
    'my back hurts, who should I see',
    'which doctor treats skin problems',
    'I have a rash on my arm',
    'what are your opening hours',
    'show me my appointments',
    'I need a vaccination for my baby',
    'is Dr Sarah Patel available on Thursday',
    'do you have a dermatologist in Khalda',
    'how much does a consultation cost',
    // Innocent phrasings close to the excluded advice entries.
    'is it serious if I miss my appointment',
    'should I be worried about the fee',
    // A real question about Amman, which is why `capital of` is not listed.
    'do you have a doctor in the capital of Jordan',
  ];

  for (const message of mustPass) {
    const result = scopeCheck(message);
    assert.equal(
      result.inScope,
      true,
      `FALSE POSITIVE on "${message}" (matched ${result.matched.join(', ')})`,
    );
  }
});

test('no entry may be a bare topic word', () => {
  // A lone `weather` or `write` is exactly what would reject the traps above.
  // Enforced structurally so it cannot be reintroduced.
  for (const phrase of [...OFF_TOPIC_PHRASES, ...MEDICAL_ADVICE_PHRASES]) {
    assert.ok(
      phrase.includes(' '),
      `"${phrase}" is a single word — intent phrases only`,
    );
  }
});

test('the decline is fixed and redirects rather than dead-ending', () => {
  const { response } = scopeCheck('write me a poem');

  assert.equal(response, OUT_OF_SCOPE_RESPONSE);
  assert.match(response, /find and book with doctors/i);
  assert.match(
    response,
    /what are you experiencing|which kind of doctor/i,
    'the user must be given a way to continue',
  );
});

test('the phrase lists cannot be reached from the database', () => {
  for (const file of ['scopePhrases.js', 'scopeCheck.js']) {
    const source = readFileSync(
      new URL(`../src/assistant/guardrails/${file}`, import.meta.url),
      'utf8',
    );
    assert.ok(!source.includes('mysql'), `${file} must not touch the database`);
    assert.ok(!source.includes('models/'), `${file} must not query models`);
    assert.ok(!source.includes('getDB'), `${file} must not open a connection`);
  }
});

test('EMERGENCY BEATS SCOPE — a crisis message never gets a booking redirect', async () => {
  noProvider();

  // The message must trip BOTH gates, or the ordering is not being tested at
  // all: "can you prescribe me" is in the medical-advice list, "kill myself"
  // in the self-harm list. Asserted here so the premise cannot rot.
  const message = 'I want to kill myself, can you prescribe me something';
  assert.equal(
    scopeCheck(message).inScope,
    false,
    'this message must trip the scope gate for the ordering test to mean anything',
  );

  const result = await runConversation({
    ctx,
    sessionId: TEST_SESSION_ID,
    system: 'test system prompt',
    messages: [{ role: 'user', content: message }],
  });

  assert.equal(result.stoppedReason, 'emergency');
  assert.equal(result.text, SELF_HARM_RESPONSE);
  assert.notEqual(
    result.text,
    OUT_OF_SCOPE_RESPONSE,
    'answering a crisis with a booking redirect would be the worst outcome here',
  );
});

test('emergency beats scope for physical emergencies too', async () => {
  noProvider();

  const result = await runConversation({
    ctx,
    sessionId: TEST_SESSION_ID,
    system: 'test system prompt',
    messages: [
      { role: 'user', content: 'he has chest pain, what should I take' },
    ],
  });

  assert.equal(result.stoppedReason, 'emergency');
  assert.equal(result.text, PHYSICAL_EMERGENCY_RESPONSE);
});

test('an out-of-scope message reaches NO provider call and NO audit row', async () => {
  noProvider();

  const result = await runConversation({
    ctx,
    sessionId: TEST_SESSION_ID,
    system: 'test system prompt',
    messages: [{ role: 'user', content: 'write me a poem about Amman' }],
  });

  assert.equal(result.stoppedReason, 'out_of_scope');
  assert.equal(result.text, OUT_OF_SCOPE_RESPONSE);
  assert.equal(result.toolCallsMade, 0);
  assert.equal(result.iterations, 0);

  const [rows] = await db.query(
    'SELECT id FROM assistant_audit_log WHERE session_id = ?',
    [TEST_SESSION_ID],
  );
  assert.equal(rows.length, 0);
});

test('the gate reads the latest user message', async () => {
  noProvider();

  const result = await runConversation({
    ctx,
    sessionId: TEST_SESSION_ID,
    system: 'test system prompt',
    messages: [
      { role: 'user', content: 'I need a dermatologist' },
      { role: 'assistant', content: 'Here are some options.' },
      { role: 'user', content: 'actually, write me a poem instead' },
    ],
  });

  assert.equal(result.stoppedReason, 'out_of_scope');
});
