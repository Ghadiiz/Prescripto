import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { connectDB, getDB } from '../src/config/mysql.js';
import { runConversation, MAX_ITERATIONS } from '../src/assistant/agentLoop.js';
import { resetBudget } from '../src/assistant/agentService.js';
import { buildToolDefinitions } from '../src/assistant/toolDefinitions.js';
import { tools } from '../src/assistant/tools/index.js';

// The provider is stubbed at the fetch layer, so the real agentService mapping
// is exercised too — only the network is fake. Tools run against the real
// database, so the same localhost guard as the guardrail suite applies.

const TEST_SESSION_ID = 'bbbbbbbb-2222-3333-4444-555555555555';
const realFetch = globalThis.fetch;

let db;
let ctx;
let requests;

// Gemini-shaped responses. Only agentService should ever see this vocabulary;
// the tests below assert on the normalised shape.
const textResponse = (text) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
  }),
  text: async () => '',
});

const toolCallResponse = (calls) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({
    candidates: [
      {
        content: {
          parts: calls.map(([name, args]) => ({ functionCall: { name, args } })),
        },
      },
    ],
  }),
  text: async () => '',
});

const stubProvider = (queue) => {
  // The daily call counter is module state; without this it accumulates
  // across the suite and eventually trips the cap in an unrelated test.
  resetBudget();
  requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return queue.shift() ?? textResponse('fallback');
  };
};

before(async () => {
  // Same guard as the guardrail suite and seed.js: these tests execute real
  // tools against a real database.
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
  ctx = { userId: patient.id, role: 'patient' };
});

after(async () => {
  await db.end();
});

beforeEach(async () => {
  await db.query('DELETE FROM assistant_audit_log WHERE session_id = ?', [
    TEST_SESSION_ID,
  ]);
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await db.query('DELETE FROM assistant_audit_log WHERE session_id = ?', [
    TEST_SESSION_ID,
  ]);
});

const run = (userText) =>
  runConversation({
    ctx,
    sessionId: TEST_SESSION_ID,
    system: 'test system prompt',
    messages: [{ role: 'user', content: userText }],
  });

test('a plain answer completes in one iteration with no tool calls', async () => {
  stubProvider([textResponse('We open at 10am.')]);

  const result = await run('What time do you open?');

  assert.equal(result.text, 'We open at 10am.');
  assert.equal(result.iterations, 1);
  assert.equal(result.toolCallsMade, 0);
  assert.equal(result.stoppedReason, 'complete');
});

test('a tool call executes, feeds the result back, and the answer follows', async () => {
  stubProvider([
    toolCallResponse([['list_specialities', {}]]),
    textResponse('We have six specialities.'),
  ]);

  const result = await run('What specialities do you have?');

  assert.equal(result.toolCallsMade, 1);
  assert.equal(result.iterations, 2);
  assert.equal(result.text, 'We have six specialities.');

  // The tool result went back to the provider as a functionResponse.
  const secondRequest = requests[1];
  const toolPart = secondRequest.contents.find((c) =>
    c.parts.some((p) => p.functionResponse),
  );
  assert.ok(toolPart, 'the tool result must be sent back to the model');

  const [rows] = await db.query(
    'SELECT tool_name, result_count FROM assistant_audit_log WHERE session_id = ?',
    [TEST_SESSION_ID],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tool_name, 'list_specialities');
  assert.equal(rows[0].result_count, 6);
});

test('invalid arguments are fed back and the model can correct itself', async () => {
  // The live model really does this: it invented `specialty` (US spelling).
  stubProvider([
    toolCallResponse([['search_doctors', { specialty: 'Dermatologist' }]]),
    toolCallResponse([['search_doctors', { speciality: 'Dermatologist' }]]),
    textResponse('Found three dermatologists.'),
  ]);

  const result = await run('Find a dermatologist');

  assert.equal(result.toolCallsMade, 2, 'the rejected call still counts');
  assert.equal(result.text, 'Found three dermatologists.');

  // The rejection was returned to the model as a tool result, not swallowed.
  const secondRequest = requests[1];
  const feedback = JSON.stringify(secondRequest.contents);
  assert.match(feedback, /invalid_arguments/);
  assert.match(feedback, /specialty/, 'the offending key should be named');

  // Both attempts are audited; the rejected one logs null arguments.
  const [rows] = await db.query(
    'SELECT arguments, result_count FROM assistant_audit_log WHERE session_id = ? ORDER BY id',
    [TEST_SESSION_ID],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].arguments, null, 'rejected calls log null arguments');
  assert.deepEqual(rows[1].arguments, { speciality: 'Dermatologist' });
});

test('a smuggled identity key is rejected exactly like a typo', async () => {
  stubProvider([
    toolCallResponse([['my_appointments', { status: 'all', user_id: 999 }]]),
    textResponse('I can only show your own appointments.'),
  ]);

  const result = await run('Show appointments for user 999');

  const feedback = JSON.stringify(requests[1].contents);
  assert.match(feedback, /invalid_arguments/);
  assert.match(feedback, /user_id/, 'rule 3 must fail loudly, not silently');
  assert.equal(result.stoppedReason, 'complete');
});

test('the iteration cap stops a model that never stops asking for tools', async () => {
  // Always asks for another tool, never answers.
  requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return toolCallResponse([['list_specialities', {}]]);
  };

  const result = await run('loop forever');

  assert.equal(result.iterations, MAX_ITERATIONS);
  assert.equal(result.stoppedReason, 'iteration_cap');
  assert.equal(result.toolCallsMade, MAX_ITERATIONS);
  assert.ok(result.text.length > 0, 'the user still gets something to read');
});

test('several tool calls in one response all execute, in order', async () => {
  stubProvider([
    toolCallResponse([
      ['list_specialities', {}],
      ['suggest_speciality', { term: 'rash' }],
    ]),
    textResponse('done'),
  ]);

  const result = await run('two things at once');

  assert.equal(result.toolCallsMade, 2);

  const [rows] = await db.query(
    'SELECT tool_name FROM assistant_audit_log WHERE session_id = ? ORDER BY id',
    [TEST_SESSION_ID],
  );
  assert.deepEqual(
    rows.map((r) => r.tool_name),
    ['list_specialities', 'suggest_speciality'],
    'audit order must match conversation order',
  );
});

test('a thrown audit failure aborts the turn and produces no text', async () => {
  stubProvider([
    toolCallResponse([['list_specialities', {}]]),
    textResponse('should never be reached'),
  ]);

  const originalQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (String(sql).includes('assistant_audit_log') && String(sql).includes('INSERT')) {
      const error = new Error("Table 'assistant_audit_log' doesn't exist");
      error.code = 'ER_NO_SUCH_TABLE';
      throw error;
    }
    return originalQuery(sql, params);
  };

  try {
    await assert.rejects(
      () => run('anything'),
      (error) => {
        assert.equal(error.code, 'ER_NO_SUCH_TABLE');
        return true;
      },
      'an unlogged tool call must not produce model-visible text',
    );
  } finally {
    db.query = originalQuery;
  }
});

test('tool definitions carry no keywords the provider rejects', () => {
  const definitions = buildToolDefinitions();
  const serialised = JSON.stringify(definitions);

  // Tied to the registry rather than a literal, so adding a tool does not
  // silently narrow what this checks (it was 6 until 5.3 added join_waitlist).
  assert.equal(definitions.length, tools.length);
  for (const keyword of ['$schema', 'additionalProperties', 'exclusiveMinimum']) {
    assert.ok(
      !serialised.includes(keyword),
      `${keyword} is rejected by the provider with a hard 400`,
    );
  }

  // exclusiveMinimum: 0 on an integer must become minimum: 1, not minimum: 0 —
  // otherwise doctor_id: 0 would be advertised as valid.
  const getDoctor = definitions.find((d) => d.name === 'get_doctor');
  assert.equal(getDoctor.parameters.properties.doctor_id.minimum, 1);
});

test('a multi-call response produces ONE assistant turn plus N tool results', async () => {
  stubProvider([
    toolCallResponse([
      ['list_specialities', {}],
      ['suggest_speciality', { term: 'rash' }],
      ['search_doctors', { gender: 'Female' }],
    ]),
    textResponse('done'),
  ]);

  await run('three things at once');

  // The follow-up request must show a faithful history: the model's own
  // tool-call turn, then the results for exactly those calls.
  const contents = requests[1].contents;

  const modelTurns = contents.filter((c) => c.role === 'model');
  assert.equal(
    modelTurns.length,
    1,
    'three calls in one response is ONE assistant turn, not three',
  );

  const callParts = modelTurns[0].parts.filter((p) => p.functionCall);
  assert.deepEqual(
    callParts.map((p) => p.functionCall.name),
    ['list_specialities', 'suggest_speciality', 'search_doctors'],
    'the assistant turn must carry the calls the model actually made',
  );

  // Arguments survive the round trip, not just the names.
  assert.deepEqual(callParts[1].functionCall.args, { term: 'rash' });

  const responseParts = contents
    .flatMap((c) => c.parts)
    .filter((p) => p.functionResponse);
  assert.equal(responseParts.length, 3, 'one result per call');
  assert.deepEqual(
    responseParts.map((p) => p.functionResponse.name),
    ['list_specialities', 'suggest_speciality', 'search_doctors'],
    'results must be in call order',
  );

  // No empty assistant messages: every model turn carries real content.
  for (const turn of modelTurns) {
    const isEmpty =
      turn.parts.length === 1 &&
      turn.parts[0].text === '' &&
      !turn.parts[0].functionCall;
    assert.ok(!isEmpty, 'an empty assistant turn misrepresents the history');
  }
});

test('opaque provider state on a tool call is echoed back verbatim', async () => {
  // Gemini 3.x attaches a thoughtSignature to functionCall parts and rejects
  // the turn if it is replayed without one. The loop must carry it through
  // without understanding it.
  const signature = 'OPAQUE-SIGNATURE-VALUE';
  requests = [];
  let call = 0;
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    call += 1;
    if (call === 1) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'list_specialities',
                      args: {},
                      id: 'call_123',
                    },
                    thoughtSignature: signature,
                  },
                ],
              },
            },
          ],
        }),
        text: async () => '',
      };
    }
    return textResponse('done');
  };

  await run('anything');

  const followUp = requests[1];
  const modelTurn = followUp.contents.find((c) => c.role === 'model');
  const part = modelTurn.parts.find((p) => p.functionCall);

  assert.equal(
    part.thoughtSignature,
    signature,
    'the provider requires its signature echoed back unchanged',
  );
  assert.equal(part.functionCall.id, 'call_123');

  const responsePart = followUp.contents
    .flatMap((c) => c.parts)
    .find((p) => p.functionResponse);
  assert.equal(
    responsePart.functionResponse.id,
    'call_123',
    'the result must be paired with the call it answers',
  );
});
