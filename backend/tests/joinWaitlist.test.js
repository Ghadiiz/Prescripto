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
let occupier;
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

// 7.5 made a waitlist entry a SINGLE SLOT, and one that must already be TAKEN
// — a free slot is refused because there is nothing to wait for. So the
// fixture books the slot with a THIRD patient: booking it with patientA or
// patientB would trip the same-day rule and change which refusal fires.
const SLOT_DATE = isoDaysFromNow(3);
const SLOT_TIME = '10:00';
const OTHER_SLOT_TIME = '11:30';

const FROM = SLOT_DATE;
const TO = isoDaysFromNow(9);

// The arguments every test starts from: one doctor, one day, one taken slot.
const slotArgs = (overrides = {}) => ({
  doctor_id: doctorId,
  date_from: SLOT_DATE,
  date_to: SLOT_DATE,
  time_from: SLOT_TIME,
  time_to: SLOT_TIME,
  ...overrides,
});

// Books `time` on `date` with `doctor` for whoever is given, so a slot can be
// made taken (the fixture) or a conflict created (the 7.5 gate).
const book = async (userId, { date = SLOT_DATE, time = SLOT_TIME, doctor } = {}) => {
  const [result] = await db.query(
    `INSERT INTO appointments (user_id, doctor_id, appointment_date, appointment_time, status, amount)
     VALUES (?, ?, ?, ?, 'pending', 50)`,
    [userId, doctor ?? doctorId, date, `${time}:00`],
  );
  return result.insertId;
};

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
  occupier = await make('occupier');

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
  // CASCADE takes the waitlist and appointment rows.
  await db.query('DELETE FROM users WHERE id IN (?, ?, ?)', [
    patientA,
    patientB,
    occupier,
  ]);
  await db.end();
  await closeRedis();
});

const clear = async () => {
  await resetConfirmations();
  const ids = [patientA, patientB, occupier];
  await db.query('DELETE FROM waitlist WHERE user_id IN (?)', [ids]);
  await db.query('DELETE FROM appointments WHERE user_id IN (?)', [ids]);
  await db.query('DELETE FROM assistant_audit_log WHERE user_id IN (?, ?)', [
    patientA,
    patientB,
  ]);
};

beforeEach(async () => {
  await clear();
  // The slot under test is TAKEN, which is the only state a waitlist request
  // is allowed in since 7.5.
  await book(occupier);
});
afterEach(clear);

// --- the core guarantee -----------------------------------------------------

test('a single call cannot write, whatever it asks for', async () => {
  const before = await countWaitlist();

  const result = await join(ctxFor(patientA), slotArgs());

  assert.equal(result.status, 'confirmation_required');
  assert.ok(result.confirmation_token, 'a token must come back');
  assert.equal(result.summary.date_from, SLOT_DATE);
  assert.equal(result.summary.time_from, SLOT_TIME);
  // Rule 7 reaches the preview: the slot is taken AS OF a moment.
  assert.equal(result.summary.slot_status, 'taken');
  assert.match(result.summary.checked_at, /^\d{4}-\d{2}-\d{2}T/);

  // The assertion that matters: the database is untouched.
  assert.equal(await countWaitlist(), before, 'the preview call wrote a row');
});

test('a second call carrying the token writes exactly one row', async () => {
  const ctx = ctxFor(patientA);
  const args = slotArgs();

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
  const args = slotArgs();

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
  const args = slotArgs();

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
  const args = slotArgs();

  const preview = await join(ctx, args);

  // The patient agreed to one slot; the write names another. (7.5 swaps the
  // TIME rather than the doctor: a different doctor's 10:00 is free, so the
  // availability refusal would fire before the token was ever examined, and
  // the test would pass for the wrong reason.)
  await book(occupier, { time: OTHER_SLOT_TIME });
  const swapped = await join(ctx, {
    ...args,
    time_from: OTHER_SLOT_TIME,
    time_to: OTHER_SLOT_TIME,
    confirmation_token: preview.confirmation_token,
  });

  assert.equal(swapped.reason, 'confirmation_invalid');
  assert.equal(await countWaitlist(), 0);
});

test('a token cannot cross conversations', async () => {
  const ctx = ctxFor(patientA);
  const args = slotArgs();

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
  const attempt = await join(
    ctxFor(patientA),
    slotArgs({ confirmation_token: 'not-a-token-we-issued' }),
  );

  assert.equal(attempt.reason, 'confirmation_invalid');
  assert.equal(await countWaitlist(), 0);
});

// --- idempotency, from the database ------------------------------------------

test('joining twice reports already_waiting and leaves one row', async () => {
  const ctx = ctxFor(patientA);
  const args = slotArgs();

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
    [slotArgs({ date_from: isoDaysFromNow(-2), date_to: isoDaysFromNow(-2) }),
      'date_in_past'],
    // 7.5 turned MAX_WINDOW_DAYS from a span into a reach: a slot further
    // ahead than the booking page can show is one the patient cannot act on.
    [slotArgs({ date_from: isoDaysFromNow(60), date_to: isoDaysFromNow(60) }),
      'date_too_far'],
    [slotArgs({ doctor_id: 99999999 }), 'doctor_not_found'],
    // 7.5: the single-slot guard. The COLUMNS still accept a range — 007's
    // schema is kept and dormant — so this refusal is the only thing making
    // single-slot a guarantee rather than a habit.
    [slotArgs({ date_to: TO }), 'not_a_single_slot'],
    [slotArgs({ time_to: '12:00' }), 'not_a_single_slot'],
    // A time nothing could ever be booked at. Without this the row is written
    // and the patient waits forever for a slot that cannot free.
    [slotArgs({ time_from: '03:00', time_to: '03:00' }), 'not_a_bookable_slot'],
    [slotArgs({ time_from: '10:17', time_to: '10:17' }), 'not_a_bookable_slot'],
    // Nothing to wait for.
    [slotArgs({ time_from: '11:00', time_to: '11:00' }), 'slot_already_free'],
  ];

  for (const [args, reason] of cases) {
    const result = await join(ctx, args);
    assert.equal(result.reason, reason, JSON.stringify(args));
    assert.ok(!result.confirmation_token, `${reason} still handed out a token`);
  }

  assert.equal(await countWaitlist(), 0);
});

// --- 7.5: one slot, and it must be a real, taken one -------------------------

test('the requested slot reaches the row as a degenerate range', async () => {
  const ctx = ctxFor(patientA);
  const args = slotArgs();

  const preview = await join(ctx, args);
  await join(ctx, { ...args, confirmation_token: preview.confirmation_token });

  const [[row]] = await db.query(
    'SELECT date_from, date_to, time_from, time_to FROM waitlist WHERE user_id = ?',
    [patientA],
  );

  // 007's range columns are still there and still correct — a single slot is
  // stored as from == to. That is the dormancy, visible in the data.
  assert.equal(row.time_from, `${SLOT_TIME}:00`);
  assert.equal(row.time_to, `${SLOT_TIME}:00`);
  assert.equal(String(row.date_from).slice(0, 10), String(row.date_to).slice(0, 10));
});

test('a multi-day request is refused at the tool, not stored', async () => {
  const result = await join(ctxFor(patientA), slotArgs({ date_to: TO }));

  assert.equal(result.reason, 'not_a_single_slot');
  assert.ok(!result.confirmation_token, 'a range was offered for confirmation');
  assert.equal(await countWaitlist(), 0);
});

test('confirming one slot cannot write a different slot', async () => {
  // 7.4's guarantee, in single-slot form. The token binds every argument, so
  // the time is covered the same way the doctor and dates are.
  const ctx = ctxFor(patientA);
  const args = slotArgs();

  const preview = await join(ctx, args);
  await book(occupier, { time: OTHER_SLOT_TIME });

  const swapped = await join(ctx, {
    ...args,
    time_from: OTHER_SLOT_TIME,
    time_to: OTHER_SLOT_TIME,
    confirmation_token: preview.confirmation_token,
  });

  assert.equal(swapped.reason, 'confirmation_invalid');
  assert.equal(await countWaitlist(), 0);
});

test('two different slots are two requests, not a duplicate', async () => {
  const ctx = ctxFor(patientA);
  await book(occupier, { time: OTHER_SLOT_TIME });

  for (const time of [SLOT_TIME, OTHER_SLOT_TIME]) {
    const args = slotArgs({ time_from: time, time_to: time });
    const preview = await join(ctx, args);
    const result = await join(ctx, {
      ...args,
      confirmation_token: preview.confirmation_token,
    });
    assert.equal(result.status, 'joined', time);
  }

  assert.equal(await countWaitlist(), 2);
});

test('the SAME slot twice reports already_waiting', async () => {
  const ctx = ctxFor(patientA);
  const args = slotArgs();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const preview = await join(ctx, args);
    const result = await join(ctx, {
      ...args,
      confirmation_token: preview.confirmation_token,
    });

    if (attempt === 1) assert.equal(result.status, 'already_waiting');
  }

  assert.equal(await countWaitlist(), 1);
});

test('a free slot is refused, with nothing written', async () => {
  const result = await join(
    ctxFor(patientA),
    slotArgs({ time_from: '11:00', time_to: '11:00' }),
  );

  assert.equal(result.reason, 'slot_already_free');
  // Rule 7: the claim is a snapshot, and says so.
  assert.match(result.checked_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(!result.confirmation_token);
  assert.equal(await countWaitlist(), 0);
});

test('a time that is not a time is rejected by the schema', async () => {
  for (const bad of ['10am', '25:00', '10:60', '10:00:00', 'morning']) {
    const parsed = joinWaitlist.schema.safeParse({
      ...slotArgs(),
      time_from: bad,
    });
    assert.equal(parsed.success, false, `${bad} was accepted`);
  }
});

test('a request with no time at all is rejected by the schema', async () => {
  // Required, and that is what forces the assistant to narrow a vague ask
  // with check_availability before it can call this tool at all.
  const parsed = joinWaitlist.schema.safeParse({
    doctor_id: doctorId,
    date_from: SLOT_DATE,
    date_to: SLOT_DATE,
  });
  assert.equal(parsed.success, false);
});

// --- 7.5: the same-doctor, same-day gate -------------------------------------

test('an appointment with THAT doctor on THAT day blocks the waitlist', async () => {
  await book(patientA, { time: '15:00' });

  const result = await join(ctxFor(patientA), slotArgs());

  assert.equal(result.reason, 'already_booked_that_day');
  assert.ok(!result.confirmation_token, 'a blocked request was offered anyway');
  assert.equal(await countWaitlist(), 0);
});

test('the refusal names the existing time and says the app cancels, not us', async () => {
  await book(patientA, { time: '15:00' });

  const result = await join(ctxFor(patientA), slotArgs());

  assert.match(result.message, /03:00 PM/, 'the patient needs to know which one');
  assert.match(result.message, /in the app/i);
  assert.match(result.message, /cannot cancel/i);
});

test('AN APPOINTMENT WITH A DIFFERENT DOCTOR DOES NOT BLOCK', async () => {
  // The hard requirement. Same patient, same day, DIFFERENT doctor — and the
  // refusal must not exist, let alone name that doctor.
  await book(patientA, { time: '15:00', doctor: otherDoctorId });

  const result = await join(ctxFor(patientA), slotArgs());

  assert.equal(result.status, 'confirmation_required');
  assert.ok(result.confirmation_token);
});

test('no message anywhere can name another doctor’s appointment', async () => {
  // Belt and braces on the same requirement, from the other side: whatever
  // the tool says, it can only have looked at the doctor it was asked about.
  const [[other]] = await db.query('SELECT name FROM doctors WHERE id = ?', [
    otherDoctorId,
  ]);
  await book(patientA, { time: '15:00', doctor: otherDoctorId });

  const result = await join(ctxFor(patientA), slotArgs());

  assert.ok(
    !JSON.stringify(result).includes(other.name),
    `the result mentioned ${other.name}, a doctor the patient never asked about`,
  );
});

test('an appointment on a DIFFERENT day does not block', async () => {
  for (const offset of [-1, 1]) {
    await book(patientA, { date: isoDaysFromNow(3 + offset), time: '15:00' });
  }

  const result = await join(ctxFor(patientA), slotArgs());

  assert.equal(result.status, 'confirmation_required');
});

test('a CANCELLED appointment that day does not block', async () => {
  const id = await book(patientA, { time: '15:00' });
  await db.query("UPDATE appointments SET status = 'cancelled' WHERE id = ?", [id]);

  const result = await join(ctxFor(patientA), slotArgs());

  assert.equal(result.status, 'confirmation_required');
});

test('the gate is STRUCTURAL: it blocks on the confirm call too', async () => {
  // The invariant would be advisory if it only ran at the preview. A conflict
  // created between the two calls must still stop the write.
  const ctx = ctxFor(patientA);
  const args = slotArgs();

  const preview = await join(ctx, args);
  assert.equal(preview.status, 'confirmation_required');

  await book(patientA, { time: '15:00' });

  const written = await join(ctx, {
    ...args,
    confirmation_token: preview.confirmation_token,
  });

  assert.equal(written.reason, 'already_booked_that_day');
  assert.equal(await countWaitlist(), 0, 'the write went through anyway');
});

test('an identity argument is rejected by the schema, not ignored', async () => {
  for (const key of ['user_id', 'userId', 'patient_id']) {
    const result = await join(ctxFor(patientA), slotArgs({ [key]: patientB }));

    assert.equal(result.error, 'invalid_arguments', `${key} was accepted`);
  }

  assert.equal(await countWaitlist(), 0);
});

// --- rule 8, with write stakes ------------------------------------------------

test('the audit row is written BEFORE the row it describes', async () => {
  const ctx = ctxFor(patientA);
  const args = slotArgs();
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
  await join(ctxFor(patientA), slotArgs());

  const [rows] = await db.query(
    "SELECT `arguments`, result_count FROM assistant_audit_log WHERE user_id = ? AND tool_name = 'join_waitlist'",
    [patientA],
  );

  assert.equal(rows.length, 1, 'a preview is still a tool call and is logged');
  assert.equal(rows[0].arguments.doctor_id, doctorId);
  assert.ok(!('confirmation_token' in rows[0].arguments));
});
