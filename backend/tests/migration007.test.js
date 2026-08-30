import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { connectDB, getDB } from '../src/config/mysql.js';

// The 007 constraints, exercised against the real database — the same bet
// migration006.test.js makes, now that the uniqueness key has TIMES in it.
//
// The most important test in this file is the FIRST one. 007 rebuilt
// `active_request` to include two nullable columns, and in MySQL
// `CONCAT('a', NULL)` is NULL while a UNIQUE index ignores NULLs entirely. So
// the naive version of this migration would have switched 006's "you are
// already on this list" guarantee OFF for every whole-day row — silently, with
// nothing looking broken and duplicates simply starting to be accepted.
//
// COALESCE is what prevents that. This suite is what proves it, because a
// comment in a .sql file guarantees nothing.

let db;
let userId;
let otherUserId;
let doctorId;

// Far future, so nothing here collides with real or seeded rows.
const FROM = '2033-05-01';
const TO = '2033-05-07';

const MORNING = ['10:00:00', '12:00:00'];
const AFTERNOON = ['14:00:00', '17:00:00'];

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

  const [[doctor]] = await db.query('SELECT id FROM doctors ORDER BY id LIMIT 1');
  doctorId = doctor.id;

  const makeUser = async (label) => {
    const [result] = await db.query(
      'INSERT INTO users (name, email, password, role, is_verified) VALUES (?, ?, ?, ?, 1)',
      [
        `Waitlist 007 ${label}`,
        `waitlist-007-${label}-${Date.now()}@example.invalid`,
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
  // CASCADE takes the waitlist rows with them.
  await db.query('DELETE FROM users WHERE id IN (?, ?)', [userId, otherUserId]);
  await db.end();
});

beforeEach(async () => {
  await db.query('DELETE FROM waitlist WHERE user_id IN (?, ?)', [
    userId,
    otherUserId,
  ]);
});

const join = (user, { from = FROM, to = TO, times = null, status = 'active' } = {}) =>
  db.query(
    `INSERT INTO waitlist (user_id, doctor_id, date_from, date_to, time_from, time_to, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [user, doctorId, from, to, times?.[0] ?? null, times?.[1] ?? null, status],
  );

const rejects = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}`);
    return true;
  });
};

// --- the trap 007 was shaped around -----------------------------------------

test('THE WHOLE-DAY GUARANTEE SURVIVES: two time-less requests still collide', async () => {
  await join(userId);

  // If `active_request` had been built without COALESCE, both rows would carry
  // NULL, the unique index would ignore them, and this INSERT would succeed —
  // 006's guarantee gone for every row that predates 007.
  await rejects(join(userId), 'ER_DUP_ENTRY');
});

test('a whole-day row actually has a key, rather than a NULL one', async () => {
  await join(userId);

  const [[row]] = await db.query(
    'SELECT active_request FROM waitlist WHERE user_id = ?',
    [userId],
  );

  assert.notEqual(row.active_request, null, 'a NULL key is an absent guarantee');
  assert.match(row.active_request, /_$/, 'the empty time components are there');
});

// --- what the times changed --------------------------------------------------

test('the same dates with DIFFERENT hours are two separate requests', async () => {
  await join(userId, { times: MORNING });
  await join(userId, { times: AFTERNOON });

  const [[{ count }]] = await db.query(
    'SELECT COUNT(*) AS count FROM waitlist WHERE user_id = ?',
    [userId],
  );

  // The point of the increment: mornings and afternoons are different asks.
  assert.equal(count, 2);
});

test('the same dates with the SAME hours still collide', async () => {
  await join(userId, { times: MORNING });

  await rejects(join(userId, { times: MORNING }), 'ER_DUP_ENTRY');
});

test('a timed request does not collide with a whole-day one', async () => {
  await join(userId);
  await join(userId, { times: MORNING });

  const [[{ count }]] = await db.query(
    'SELECT COUNT(*) AS count FROM waitlist WHERE user_id = ?',
    [userId],
  );

  assert.equal(count, 2);
});

test('two patients may hold the same doctor, dates and hours', async () => {
  await join(userId, { times: MORNING });
  await join(otherUserId, { times: MORNING });

  const [[{ count }]] = await db.query(
    'SELECT COUNT(*) AS count FROM waitlist WHERE user_id IN (?, ?)',
    [userId, otherUserId],
  );

  assert.equal(count, 2);
});

// --- the new CHECKs ----------------------------------------------------------

test('a half-specified window is rejected', async () => {
  // `time BETWEEN '10:00:00' AND NULL` is NULL — neither true nor false — so a
  // one-sided window would quietly match nothing forever.
  await rejects(
    join(userId, { times: ['10:00:00', null] }),
    'ER_CHECK_CONSTRAINT_VIOLATED',
  );
  await rejects(
    join(userId, { times: [null, '12:00:00'] }),
    'ER_CHECK_CONSTRAINT_VIOLATED',
  );
});

test('a reversed time range is rejected', async () => {
  await rejects(
    join(userId, { times: ['17:00:00', '09:00:00'] }),
    'ER_CHECK_CONSTRAINT_VIOLATED',
  );
});

test('a window that starts and ends at the same time is allowed', async () => {
  // One half-hour, which is a legitimate ask: "tell me if 10:00 opens up".
  await join(userId, { times: ['10:00:00', '10:00:00'] });

  const [[{ count }]] = await db.query(
    'SELECT COUNT(*) AS count FROM waitlist WHERE user_id = ?',
    [userId],
  );
  assert.equal(count, 1);
});

// --- 006's guarantees, still holding with times in play ----------------------

test('cancelling releases the slot, hours and all', async () => {
  await join(userId, { times: MORNING });
  await db.query("UPDATE waitlist SET status = 'cancelled' WHERE user_id = ?", [
    userId,
  ]);

  // The cancelled row's key goes NULL, so the same request can be made again.
  await join(userId, { times: MORNING });

  const [[{ count }]] = await db.query(
    "SELECT COUNT(*) AS count FROM waitlist WHERE user_id = ? AND status = 'active'",
    [userId],
  );
  assert.equal(count, 1);
});

test('being notified still does NOT release the slot', async () => {
  await join(userId, { times: MORNING });
  await db.query("UPDATE waitlist SET status = 'notified' WHERE user_id = ?", [
    userId,
  ]);

  await rejects(join(userId, { times: MORNING }), 'ER_DUP_ENTRY');
});

test('a reversed DATE range is still rejected', async () => {
  await rejects(
    join(userId, { from: TO, to: FROM }),
    'ER_CHECK_CONSTRAINT_VIOLATED',
  );
});
