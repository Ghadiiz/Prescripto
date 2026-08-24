import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { connectDB, getDB } from '../src/config/mysql.js';

// The 006 constraints, exercised against the real database.
//
// These are not schema documentation tests. Phase 5 adds the first tool that
// WRITES, and the whole design bet is that the database — not the tool —
// prevents duplicate waitlist entries. If that bet is wrong, 5.3 needs
// read-then-write logic with a race in it, so it is worth proving now.

let db;
let userId;
let otherUserId;
let doctorId;
let otherDoctorId;

// Far future, so nothing here can collide with real or seeded rows.
const FROM = '2032-04-01';
const TO = '2032-04-07';

before(async () => {
  const dbHost = process.env.DB_HOST || '';
  if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
    throw new Error(
      `Refusing to run tests: DB_HOST is "${dbHost}", not localhost. ` +
        'These tests insert and delete rows.',
    );
  }

  await connectDB();
  db = getDB();

  const [doctors] = await db.query('SELECT id FROM doctors ORDER BY id LIMIT 2');
  doctorId = doctors[0].id;
  otherDoctorId = doctors[1].id;

  const makeUser = async (label) => {
    const [result] = await db.query(
      'INSERT INTO users (name, email, password, role, is_verified) VALUES (?, ?, ?, ?, 1)',
      [
        `Waitlist Test ${label}`,
        `waitlist-test-${label}-${Date.now()}@example.invalid`,
        'not-a-real-password-hash',
        'patient',
      ],
    );
    return result.insertId;
  };

  userId = await makeUser('A');
  otherUserId = await makeUser('B');
});

after(async () => {
  // CASCADE takes the waitlist and notification rows with them.
  await db.query('DELETE FROM users WHERE id IN (?, ?)', [userId, otherUserId]);
  await db.end();
});

const clear = async () => {
  await db.query('DELETE FROM waitlist WHERE user_id IN (?, ?)', [
    userId,
    otherUserId,
  ]);
  await db.query('DELETE FROM notifications WHERE user_id IN (?, ?)', [
    userId,
    otherUserId,
  ]);
};

beforeEach(clear);
afterEach(clear);

const join = (overrides = {}) => {
  const row = {
    user_id: userId,
    doctor_id: doctorId,
    date_from: FROM,
    date_to: TO,
    status: 'active',
    ...overrides,
  };

  return db.query(
    'INSERT INTO waitlist (user_id, doctor_id, date_from, date_to, status) VALUES (?, ?, ?, ?, ?)',
    [row.user_id, row.doctor_id, row.date_from, row.date_to, row.status],
  );
};

const errorCodeOf = async (promise) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error.code;
  }
};

// --- the idempotency guarantee ----------------------------------------------

test('the same patient cannot join the same window twice', async () => {
  await join();

  // No read-then-write in sight: the database refuses the second insert. This
  // is what lets 5.3 be a small function with no locking and no race.
  assert.equal(await errorCodeOf(join()), 'ER_DUP_ENTRY');
});

test('cancelling releases the slot so the patient can rejoin', async () => {
  const [first] = await join();

  await db.query('UPDATE waitlist SET status = ? WHERE id = ?', [
    'cancelled',
    first.insertId,
  ]);

  assert.equal(await errorCodeOf(join()), null, 'rejoining must be allowed');

  // And the cancelled row is still there — cancelling is not deleting.
  const [rows] = await db.query(
    'SELECT status FROM waitlist WHERE user_id = ? ORDER BY id',
    [userId],
  );
  assert.deepEqual(
    rows.map((r) => r.status),
    ['cancelled', 'active'],
  );
});

test('being notified does NOT release the slot', async () => {
  const [first] = await join();

  await db.query('UPDATE waitlist SET status = ? WHERE id = ?', [
    'notified',
    first.insertId,
  ]);

  // The deliberate choice: a patient told about an opening cannot silently
  // stack a second identical request. They cancel first.
  assert.equal(await errorCodeOf(join()), 'ER_DUP_ENTRY');
});

test('the constraint is scoped to the exact request, not the patient', async () => {
  await join();

  // Everything that legitimately differs must still be allowed.
  assert.equal(await errorCodeOf(join({ date_from: '2032-05-01', date_to: '2032-05-07' })), null);
  assert.equal(await errorCodeOf(join({ doctor_id: otherDoctorId })), null);
  assert.equal(await errorCodeOf(join({ user_id: otherUserId })), null);
});

test('two patients may wait on the same doctor and window', async () => {
  // The obvious way to get this wrong is a unique key on (doctor, dates)
  // alone, which would make a waitlist hold exactly one person.
  assert.equal(await errorCodeOf(join()), null);
  assert.equal(await errorCodeOf(join({ user_id: otherUserId })), null);

  const [[{ n }]] = await db.query(
    'SELECT COUNT(*) AS n FROM waitlist WHERE doctor_id = ? AND date_from = ?',
    [doctorId, FROM],
  );
  assert.equal(n, 2);
});

// --- the other constraints --------------------------------------------------

test('a reversed date range is rejected', async () => {
  assert.equal(
    await errorCodeOf(join({ date_from: TO, date_to: FROM })),
    'ER_CHECK_CONSTRAINT_VIOLATED',
  );

  // A single-day window is a legitimate request, not a reversed one.
  assert.equal(await errorCodeOf(join({ date_from: FROM, date_to: FROM })), null);
});

test('waitlist rows cannot name a user or doctor that does not exist', async () => {
  assert.equal(await errorCodeOf(join({ user_id: 99999999 })), 'ER_NO_REFERENCED_ROW_2');
  assert.equal(await errorCodeOf(join({ doctor_id: 99999999 })), 'ER_NO_REFERENCED_ROW_2');
});

// --- notifications ----------------------------------------------------------

const notify = (overrides = {}) =>
  db.query('INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)', [
    overrides.user_id ?? userId,
    overrides.type ?? 'waitlist_slot_open',
    JSON.stringify(overrides.payload ?? { doctor_id: doctorId, date: FROM }),
  ]);

test('a notification cannot be addressed to a user who does not exist', async () => {
  assert.equal(await errorCodeOf(notify({ user_id: 99999999 })), 'ER_NO_REFERENCED_ROW_2');
});

test('read_at is NULL until read, and that is the unread filter', async () => {
  await notify();
  await notify();

  const unread = async () => {
    const [[row]] = await db.query(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [userId],
    );
    return row.n;
  };

  assert.equal(await unread(), 2, 'new notifications start unread');

  await db.query(
    'UPDATE notifications SET read_at = NOW() WHERE user_id = ? LIMIT 1',
    [userId],
  );

  assert.equal(await unread(), 1);

  // read_at records WHEN, which a boolean could not.
  const [[read]] = await db.query(
    'SELECT read_at FROM notifications WHERE user_id = ? AND read_at IS NOT NULL',
    [userId],
  );
  assert.ok(read.read_at instanceof Date);
});

test('the payload round-trips as JSON, not a string', async () => {
  await notify({ payload: { doctor_id: doctorId, date: FROM, doctor_name: 'Dr. X' } });

  const [[row]] = await db.query(
    'SELECT payload FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    [userId],
  );

  assert.equal(typeof row.payload, 'object');
  assert.equal(row.payload.doctor_name, 'Dr. X');
});

test('the unread lookup uses its index rather than scanning', async () => {
  await notify();

  const [plan] = await db.query(
    'EXPLAIN SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [userId],
  );

  assert.equal(
    plan[0].key,
    'idx_unread',
    `expected idx_unread, got ${plan[0].key} (type ${plan[0].type})`,
  );
});

// --- cascade ----------------------------------------------------------------

test('deleting a patient takes their waitlist and notifications with them', async () => {
  const [result] = await db.query(
    'INSERT INTO users (name, email, password, role, is_verified) VALUES (?, ?, ?, ?, 1)',
    ['Cascade Test', `cascade-${Date.now()}@example.invalid`, 'x', 'patient'],
  );
  const doomed = result.insertId;

  await join({ user_id: doomed });
  await notify({ user_id: doomed });

  await db.query('DELETE FROM users WHERE id = ?', [doomed]);

  const [[w]] = await db.query(
    'SELECT COUNT(*) AS n FROM waitlist WHERE user_id = ?',
    [doomed],
  );
  const [[n]] = await db.query(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?',
    [doomed],
  );

  assert.equal(w.n, 0, 'orphan waitlist rows must not survive the patient');
  assert.equal(n.n, 0, 'orphan notifications must not survive the patient');
});
