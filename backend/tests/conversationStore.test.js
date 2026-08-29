import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { closeRedis } from '../src/config/redis.js';

import { connectDB, getDB } from '../src/config/mysql.js';
import {
  loadHistory,
  saveHistory,
  appendTurn,
  purgeExpiredConversations,
  MAX_TURNS,
  RETENTION_DAYS,
} from '../src/assistant/conversationStore.js';
import { generate, resetBudget } from '../src/assistant/agentService.js';
import { buildToolDefinitions } from '../src/assistant/toolDefinitions.js';

const AUDIT_SESSION_ID = 'dadadada-2222-3333-4444-555555555555';
const realFetch = globalThis.fetch;

let db;
let patientCtx;
let doctorCtx;

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

  // Same numeric id, different role — the collision 0.4 added the column for.
  patientCtx = { userId: patient.id, role: 'patient' };
  doctorCtx = { userId: patient.id, role: 'doctor' };
});

after(async () => {
  await db.end();
  await closeRedis();
});

const cleanup = async () => {
  await resetBudget();
  await db.query('DELETE FROM conversations WHERE user_id = ?', [
    patientCtx.userId,
  ]);
  await db.query('DELETE FROM assistant_audit_log WHERE session_id = ?', [
    AUDIT_SESSION_ID,
  ]);
};

beforeEach(cleanup);
afterEach(async () => {
  globalThis.fetch = realFetch;
  await cleanup();
});

test('a saved conversation round-trips', async () => {
  const messages = [
    { role: 'user', content: 'find me a dermatologist' },
    { role: 'assistant', content: 'Here are three.' },
  ];

  await saveHistory(patientCtx, messages);

  assert.deepEqual(await loadHistory(patientCtx), messages);
});

test('an absent conversation loads as an empty array, not null', async () => {
  assert.deepEqual(await loadHistory(patientCtx), []);
});

test('history is scoped by user_id AND role, never user_id alone', async () => {
  // The 0.4 bug: patient #5 and doctor #5 are different people.
  await saveHistory(patientCtx, [
    { role: 'user', content: 'PATIENT SIDE' },
    { role: 'assistant', content: 'patient reply' },
  ]);
  await saveHistory(doctorCtx, [
    { role: 'user', content: 'DOCTOR SIDE' },
    { role: 'assistant', content: 'doctor reply' },
  ]);

  const patientHistory = await loadHistory(patientCtx);
  const doctorHistory = await loadHistory(doctorCtx);

  assert.equal(patientHistory[0].content, 'PATIENT SIDE');
  assert.equal(doctorHistory[0].content, 'DOCTOR SIDE');
  assert.notDeepEqual(
    patientHistory,
    doctorHistory,
    'the same user id under a different role must not share history',
  );

  // And a role with no history gets nothing, rather than someone else's.
  await db.query('DELETE FROM conversations WHERE user_id = ? AND role = ?', [
    doctorCtx.userId,
    'doctor',
  ]);
  assert.deepEqual(await loadHistory(doctorCtx), []);
});

test('saving twice for one pair leaves exactly one row', async () => {
  await saveHistory(patientCtx, [{ role: 'user', content: 'first' }]);
  await saveHistory(patientCtx, [{ role: 'user', content: 'second' }]);

  const [rows] = await db.query(
    'SELECT messages FROM conversations WHERE user_id = ? AND role = ?',
    [patientCtx.userId, 'patient'],
  );

  assert.equal(rows.length, 1, 'the upsert must not fragment history');
  assert.equal(rows[0].messages[0].content, 'second');
});

test('history is trimmed to the most recent MAX_TURNS', async () => {
  let history = [];
  for (let turn = 1; turn <= 15; turn += 1) {
    history = appendTurn(history, `question ${turn}`, `answer ${turn}`);
  }

  assert.equal(history.length, MAX_TURNS * 2, '10 turns is 20 messages');
  assert.equal(history[0].content, 'question 6', 'oldest turns drop first');
  assert.equal(history.at(-1).content, 'answer 15');

  await saveHistory(patientCtx, history);
  const loaded = await loadHistory(patientCtx);
  assert.equal(loaded.length, MAX_TURNS * 2);
  assert.equal(loaded.at(-1).content, 'answer 15');
});

test('only human-readable text is stored — no tool or provider internals', async () => {
  // What a real turn looks like inside the loop, including the plumbing that
  // must NOT reach the database.
  const loopMessages = [
    { role: 'user', content: 'find a dermatologist in Khalda' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          name: 'search_doctors',
          args: { area: 'Khalda' },
          providerRef: { id: 'call_1', thoughtSignature: 'OPAQUE' },
        },
      ],
    },
    {
      role: 'tool',
      name: 'search_doctors',
      content: JSON.stringify([
        { name: 'Dr. Ava Mitchell', maps_url: 'https://maps.example/x' },
      ]),
    },
  ];

  const history = appendTurn([], loopMessages[0].content, 'Dr. Ava Mitchell is in Khalda.');
  await saveHistory(patientCtx, history);

  const [rows] = await db.query(
    'SELECT messages FROM conversations WHERE user_id = ? AND role = ?',
    [patientCtx.userId, 'patient'],
  );
  const stored = JSON.stringify(rows[0].messages);

  for (const forbidden of [
    'toolCalls',
    'providerRef',
    'thoughtSignature',
    'functionCall',
    'maps_url',
    'OPAQUE',
  ]) {
    assert.ok(
      !stored.includes(forbidden),
      `"${forbidden}" must never be persisted in conversation history`,
    );
  }

  // Only the two text messages.
  assert.equal(rows[0].messages.length, 2);
  assert.deepEqual(Object.keys(rows[0].messages[0]).sort(), ['content', 'role']);
});

test('conversations older than the retention window are swept', async () => {
  await saveHistory(patientCtx, [{ role: 'user', content: 'old' }]);
  await db.query(
    'UPDATE conversations SET updated_at = NOW() - INTERVAL ? DAY WHERE user_id = ?',
    [RETENTION_DAYS + 1, patientCtx.userId],
  );

  const deleted = await purgeExpiredConversations(RETENTION_DAYS);

  assert.ok(deleted >= 1);
  assert.deepEqual(await loadHistory(patientCtx), []);
});

test('conversations inside the retention window survive the sweep', async () => {
  await saveHistory(patientCtx, [{ role: 'user', content: 'recent' }]);
  await db.query(
    'UPDATE conversations SET updated_at = NOW() - INTERVAL ? DAY WHERE user_id = ?',
    [RETENTION_DAYS - 1, patientCtx.userId],
  );

  await purgeExpiredConversations(RETENTION_DAYS);

  assert.equal((await loadHistory(patientCtx)).length, 1);
});

test('audit rows are NOT swept — the asymmetry from 1.7', async () => {
  // Conversations expire because they are a copy of the chat. Audit rows do
  // not, because they are a security record.
  await db.query(
    `INSERT INTO assistant_audit_log
       (session_id, user_id, role, tool_name, arguments, result_count, created_at)
     VALUES (?, ?, 'patient', 'search_doctors', NULL, 1, NOW() - INTERVAL ? DAY)`,
    [AUDIT_SESSION_ID, patientCtx.userId, RETENTION_DAYS + 60],
  );

  await purgeExpiredConversations(RETENTION_DAYS);

  const [rows] = await db.query(
    'SELECT id FROM assistant_audit_log WHERE session_id = ?',
    [AUDIT_SESSION_ID],
  );
  assert.equal(rows.length, 1, 'an audit trail must outlive the conversation');
});

test('loaded history replays as conversation, with no functionCall parts', async () => {
  await saveHistory(patientCtx, [
    { role: 'user', content: 'find a female dermatologist' },
    { role: 'assistant', content: 'Dr. Ava Mitchell is in Khalda.' },
  ]);

  let sent;
  globalThis.fetch = async (url, options) => {
    sent = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
      text: async () => '',
    };
  };

  await generate({
    system: 'SYSTEM PROMPT',
    messages: await loadHistory(patientCtx),
    tools: buildToolDefinitions(),
  });

  const serialised = JSON.stringify(sent);
  assert.ok(
    !serialised.includes('functionCall'),
    'stored history must not produce functionCall parts — that is what would ' +
      'require a thoughtSignature the database does not have',
  );

  // Replayed as conversation, never as instruction.
  assert.equal(sent.systemInstruction.parts[0].text, 'SYSTEM PROMPT');
  assert.ok(!JSON.stringify(sent.systemInstruction).includes('Ava Mitchell'));
  const modelTurn = sent.contents.find((c) => c.role === 'model');
  assert.match(modelTurn.parts[0].text, /Ava Mitchell/);
});
