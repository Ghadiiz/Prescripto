import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { closeRedis } from '../src/config/redis.js';

import { connectDB, getDB } from '../src/config/mysql.js';
import { runTool } from '../src/assistant/runTool.js';
import { resetConfirmations } from '../src/assistant/confirmations.js';
import joinWaitlist from '../src/assistant/tools/joinWaitlist.js';

// The only write tool.
//
// Every test here goes through runTool rather than the handler, because the
// audit row is part of the guarantee and runTool is what writes it. Calling
// tool.handler directly would test half the thing.

let db;
let patientA;
let patientB;
let doctorId;
let otherDoctorId;

const SESSION_A = '11111111-1111-1111-1111-111111111111';
const SESSION_B = '22222222-2222-2222-2222-222222222222';

const ctxFor = (userId) => ({ userId, role: 'patient' });

const isoDaysFromNow = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const FROM = isoDaysFromNow(3);
const TO = isoDaysFromNow(9);

const join = (ctx, args, sessionId = SESSION_A) =>
  runTool(ctx, 'join_waitlist', args, { sessionId });

const countWaitlist = async () => {
  const [[row]] = await db.query(
    'SELECT COUNT(*) AS n FROM waitlist WHERE user_id IN (?, ?)',
    [patientA, patientB],
  );
  return row.n;
};

before(async () => {
  const dbHost = process.env.DB_HOST || '';
  if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
    throw new Error(`Refusing to run tests: DB_HOST is "${dbHost}", not localhost.`);
  }

  await connectDB();
  db = getDB();

  const make = async (label) => {
    const [result] = await db.query(
      'INSERT INTO users (name, email, password, role, is_verified) VALUES (?, ?, ?, ?, 1)',
      [
        `Waitlist Tool ${label}`,
        `waitlist-tool-${label}-${Date.now()}@example.invalid`,
        'not-a-real-password-hash',
        'patient',
      ],
    );
    return result.insertId;
  };

  patientA = await make('A');
  patientB = await make('B');

  const [doctors] = await db.query(
    'SELECT id FROM doctors WHERE available = 1 ORDER BY id LIMIT 2',
  );
  doctorId = doctors[0].id;
  otherDoctorId = doctors[1].id;
});

after(async () => {
  await db.query('DELETE FROM assistant_audit_log WHERE user_id IN (?, ?)', [
    patientA,
    patientB,
  ]);
  // CASCADE takes the waitlist rows.
  await db.query('DELETE FROM users WHERE id IN (?, ?)', [patientA, patientB]);
  await db.end();
  await closeRedis();
});

const clear = async () => {
  await resetConfirmations();
  await db.query('DELETE FROM waitlist WHERE user_id IN (?, ?)', [patientA, patientB]);
  await db.query('DELETE FROM assistant_audit_log WHERE user_id IN (?, ?)', [
    patientA,
    patientB,
  ]);
};

beforeEach(clear);
afterEach(clear);

// --- the core guarantee -----------------------------------------------------

test('a single call cannot write, whatever it asks for', async () => {
  const before = await countWaitlist();

  const result = await join(ctxFor(patientA), {
    doctor_id: doctorId,
    date_from: FROM,
    date_to: TO,
  });

  assert.equal(result.status, 'confirmation_required');
  assert.ok(result.confirmation_token, 'a token must come back');
  assert.equal(result.summary.date_from, FROM);

  // The assertion that matters: the database is untouched.
  assert.equal(await countWaitlist(), before, 'the preview call wrote a row');
});

test('a second call carrying the token writes exactly one row', async () => {
  const ctx = ctxFor(patientA);
  const args = { doctor_id: doctorId, date_from: FROM, date_to: TO };

  const preview = await join(ctx, args);
  const written = await join(ctx, {
    ...args,
    confirmation_token: preview.confirmation_token,
  });

  assert.equal(written.status, 'joined');
  assert.ok(written.waitlist_id);
  assert.equal(await countWaitlist(), 1);

  // The row belongs to ctx.userId — never to anything in args.
  const [[row]] = await db.query('SELECT user_id, doctor_id FROM waitlist WHERE id = ?', [
    written.waitlist_id,
  ]);
  assert.equal(row.user_id, patientA);
  assert.equal(row.doctor_id, doctorId);
});

// --- what the token is bound to ---------------------------------------------

test('a token minted for one patient cannot be spent by another', async () => {
  const args = { doctor_id: doctorId, date_from: FROM, date_to: TO };

  const preview = await join(ctxFor(patientA), args);

  // Patient B presents patient A's token. This is the difference between a
  // confirmation and a capability anyone can pick up.
  const attempt = await join(ctxFor(patientB), {
    ...args,
    confirmation_token: preview.confirmation_token,
  });

  assert.equal(attempt.status, 'refused');
  assert.equal(attempt.reason, 'confirmation_invalid');
  assert.equal(await countWaitlist(), 0, 'a row was created for the wrong patient');
});

test('a token cannot be replayed', async () => {
  const ctx = ctxFor(patientA);
  const args = { doctor_id: doctorId, date_from: FROM, date_to: TO };

  const preview = await join(ctx, args);
  const withToken = { ...args, confirmation_token: preview.confirmation_token };

  await join(ctx, withToken);
  const replay = await join(ctx, withToken);

  assert.equal(replay.status, 'refused');
  assert.equal(replay.reason, 'confirmation_invalid');
  assert.equal(await countWaitlist(), 1, 'the replay created a second row');
});

test('a token cannot be spent for different details than it was shown for', async () => {
  const ctx = ctxFor(patientA);
  const args = { doctor_id: doctorId, date_from: FROM, date_to: TO };

  const preview = await join(ctx, args);

  // The patient agreed to one doctor; the write names another.
  const swapped = await join(ctx, {
    ...args,
    doctor_id: otherDoctorId,
    confirmation_token: preview.confirmation_token,
  });

  assert.equal(swapped.reason, 'confirmation_invalid');
  assert.equal(await countWaitlist(), 0);
});

test('a token cannot cross conversations', async () => {
  const ctx = ctxFor(patientA);
  const args = { doctor_id: doctorId, date_from: FROM, date_to: TO };

  const preview = await join(ctx, args, SESSION_A);
  const elsewhere = await join(
    ctx,
    { ...args, confirmation_token: preview.confirmation_token },
    SESSION_B,
  );

  assert.equal(elsewhere.reason, 'confirmation_invalid');
  assert.equal(await countWaitlist(), 0);
});

test('an invented token is refused', async () => {
  const attempt = await join(ctxFor(patientA), {
    doctor_id: doctorId,
    date_from: FROM,
    date_to: TO,
    confirmation_token: 'not-a-token-we-issued',
  });

  assert.equal(attempt.reason, 'confirmation_invalid');
  assert.equal(await countWaitlist(), 0);
});

// --- idempotency, from the database ------------------------------------------

test('joining twice reports already_waiting and leaves one row', async () => {
  const ctx = ctxFor(patientA);
  const args = { doctor_id: doctorId, date_from: FROM, date_to: TO };

  const first = await join(ctx, args);
  await join(ctx, { ...args, confirmation_token: first.confirmation_token });

  const second = await join(ctx, args);
  const again = await join(ctx, {
    ...args,
    confirmation_token: second.confirmation_token,
  });

  // 006's unique_active_request produced ER_DUP_ENTRY; the tool reports the
  // desired state rather than an error, and never raced to check first.
  assert.equal(again.status, 'already_waiting');
  assert.equal(await countWaitlist(), 1);
});

// --- validation, before anything is offered ----------------------------------

test('bad requests are refused at the preview, minting no token', async () => {
  const ctx = ctxFor(patientA);

  const cases = [
    [{ doctor_id: doctorId, date_from: isoDaysFromNow(-2), date_to: TO }, 'date_in_past'],
    [{ doctor_id: doctorId, date_from: TO, date_to: FROM }, 'range_reversed'],
    [
      { doctor_id: doctorId, date_from: FROM, date_to: isoDaysFromNow(60) },
      'range_too_long',
    ],
    [{ doctor_id: 99999999, date_from: FROM, date_to: TO }, 'doctor_not_found'],
    // 7.4. Both bounds or neither: a one-sided window cannot be matched
    // against, and the database CHECKs it too — but a refusal the model can
    // read beats a constraint violation thrown after the patient confirmed.
    [
      { doctor_id: doctorId, date_from: FROM, date_to: TO, time_from: '10:00' },
      'time_range_incomplete',
    ],
    [
      { doctor_id: doctorId, date_from: FROM, date_to: TO, time_to: '12:00' },
      'time_range_incomplete',
    ],
    [
      {
        doctor_id: doctorId,
        date_from: FROM,
        date_to: TO,
        time_from: '17:00',
        time_to: '09:00',
      },
      'time_range_reversed',
    ],
  ];

  for (const [args, reason] of cases) {
    const result = await join(ctx, args);
    assert.equal(result.reason, reason, JSON.stringify(args));
    assert.ok(!result.confirmation_token, `${reason} still handed out a token`);
  }

  assert.equal(await countWaitlist(), 0);
});

// --- 7.4: the time window ----------------------------------------------------

test('the requested hours reach the row', async () => {
  const ctx = ctxFor(patientA);
  const args = {
    doctor_id: doctorId,
    date_from: FROM,
    date_to: TO,
    time_from: '10:00',
    time_to: '12:00',
  };

  const preview = await join(ctx, args);
  assert.equal(preview.summary.time_from, '10:00');
  assert.equal(preview.summary.time_to, '12:00');

  await join(ctx, { ...args, confirmation_token: preview.confirmation_token });

  const [[row]] = await db.query(
    'SELECT time_from, time_to FROM waitlist WHERE user_id = ?',
    [patientA],
  );

  // MySQL hands TIME back as HH:MM:SS.
  assert.equal(row.time_from, '10:00:00');
  assert.equal(row.time_to, '12:00:00');
});

test('a request with no hours still writes a whole-day row', async () => {
  const ctx = ctxFor(patientA);
  const args = { doctor_id: doctorId, date_from: FROM, date_to: TO };

  const preview = await join(ctx, args);
  assert.equal(preview.summary.time_from, null);

  await join(ctx, { ...args, confirmation_token: preview.confirmation_token });

  const [[row]] = await db.query(
    'SELECT time_from, time_to FROM waitlist WHERE user_id = ?',
    [patientA],
  );
  assert.equal(row.time_from, null);
  assert.equal(row.time_to, null);
});

test('confirming a MORNING request cannot write an afternoon one', async () => {
  // The token is bound to the whole argument object, so 7.4's new fields are
  // covered by 5.3's guarantee without any change to it. Worth asserting: the
  // hours are the part a patient is most likely to be shown and agree to.
  const ctx = ctxFor(patientA);
  const morning = {
    doctor_id: doctorId,
    date_from: FROM,
    date_to: TO,
    time_from: '10:00',
    time_to: '12:00',
  };

  const preview = await join(ctx, morning);

  const result = await join(ctx, {
    ...morning,
    time_from: '14:00',
    time_to: '17:00',
    confirmation_token: preview.confirmation_token,
  });

  assert.equal(result.reason, 'confirmation_invalid');
  assert.equal(await countWaitlist(), 0);
});

test('mornings and afternoons are two requests, not a duplicate', async () => {
  const ctx = ctxFor(patientA);
  const base = { doctor_id: doctorId, date_from: FROM, date_to: TO };

  for (const times of [
    { time_from: '10:00', time_to: '12:00' },
    { time_from: '14:00', time_to: '17:00' },
  ]) {
    const args = { ...base, ...times };
    const preview = await join(ctx, args);
    const result = await join(ctx, {
      ...args,
      confirmation_token: preview.confirmation_token,
    });
    assert.equal(result.status, 'joined', JSON.stringify(times));
  }

  assert.equal(await countWaitlist(), 2);
});

test('the SAME hours twice reports already_waiting', async () => {
  const ctx = ctxFor(patientA);
  const args = {
    doctor_id: doctorId,
    date_from: FROM,
    date_to: TO,
    time_from: '10:00',
    time_to: '12:00',
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const preview = await join(ctx, args);
    const result = await join(ctx, {
      ...args,
      confirmation_token: preview.confirmation_token,
    });

    if (attempt === 1) {
      assert.equal(result.status, 'already_waiting');
      assert.match(result.message, /dates and hours/);
    }
  }

  assert.equal(await countWaitlist(), 1);
});

test('a time that is not a time is rejected by the schema', async () => {
  for (const bad of ['10am', '25:00', '10:60', '10:00:00', 'morning']) {
    const parsed = joinWaitlist.schema.safeParse({
      doctor_id: doctorId,
      date_from: FROM,
      date_to: TO,
      time_from: bad,
      time_to: '12:00',
    });
    assert.equal(parsed.success, false, `${bad} was accepted`);
  }
});

test('an identity argument is rejected by the schema, not ignored', async () => {
  for (const key of ['user_id', 'userId', 'patient_id']) {
    const result = await join(ctxFor(patientA), {
      doctor_id: doctorId,
      date_from: FROM,
      date_to: TO,
      [key]: patientB,
    });

    assert.equal(result.error, 'invalid_arguments', `${key} was accepted`);
  }

  assert.equal(await countWaitlist(), 0);
});

// --- rule 8, with write stakes ------------------------------------------------

test('the audit row is written BEFORE the row it describes', async () => {
  const ctx = ctxFor(patientA);
  const args = { doctor_id: doctorId, date_from: FROM, date_to: TO };
  const preview = await join(ctx, args);

  // Prove the ordering by observing from inside the write itself: at the
  // moment the INSERT runs, the audit row must already exist. Reading it
  // afterwards could not tell log-before from log-after.
  const seen = { auditRowsAtWriteTime: null, resultCountAtWriteTime: undefined };

  const original = db.query.bind(db);
  db.query = async (sql, params) => {
    if (typeof sql === 'string' && sql.includes('INSERT INTO waitlist')) {
      const [rows] = await original(
        "SELECT result_count FROM assistant_audit_log WHERE user_id = ? AND tool_name = 'join_waitlist'",
        [patientA],
      );
      seen.auditRowsAtWriteTime = rows.length;
      seen.resultCountAtWriteTime = rows.at(-1)?.result_count;
    }
    return original(sql, params);
  };

  try {
    await join(ctx, { ...args, confirmation_token: preview.confirmation_token });
  } finally {
    db.query = original;
  }

  assert.ok(
    seen.auditRowsAtWriteTime >= 1,
    'the write happened with no audit row in place — rule 8 requires the ' +
      'attempt to be recorded before the row lands',
  );
  assert.equal(
    seen.resultCountAtWriteTime,
    null,
    'the pre-write row should read as "attempted, outcome unknown"',
  );

  // And the outcome is filled in once the write succeeds.
  const [[after]] = await db.query(
    "SELECT result_count FROM assistant_audit_log WHERE user_id = ? AND tool_name = 'join_waitlist' ORDER BY id DESC LIMIT 1",
    [patientA],
  );
  assert.equal(after.result_count, 1);
});

test('the preview is audited too, and carries no token in its arguments', async () => {
  await join(ctxFor(patientA), {
    doctor_id: doctorId,
    date_from: FROM,
    date_to: TO,
  });

  const [rows] = await db.query(
    "SELECT `arguments`, result_count FROM assistant_audit_log WHERE user_id = ? AND tool_name = 'join_waitlist'",
    [patientA],
  );

  assert.equal(rows.length, 1, 'a preview is still a tool call and is logged');
  assert.equal(rows[0].arguments.doctor_id, doctorId);
  assert.ok(!('confirmation_token' in rows[0].arguments));
});
