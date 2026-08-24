import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

import { connectDB, getDB } from '../src/config/mysql.js';
import notificationRoutes from '../src/notifications/routes/notificationRoutes.js';
import { NOTIFICATION_TYPE } from '../src/constants/notificationTypes.js';

// The notifications API over a real HTTP server against the real database.
//
// Nothing writes notifications until 5.4, so these tests insert their own.
//
// The test that matters is the cross-user one: mark-read is the first write
// endpoint in Phase 5, and its whole guarantee is that patient A cannot touch
// patient B's row. That is asserted by reading B's row DIRECTLY afterwards
// rather than believing what A's response said.

const realFetch = globalThis.fetch;

let db;
let server;
let baseUrl;
let patientA;
let patientB;
let doctorUserId;

const makePatient = async (label) => {
  const [result] = await db.query(
    'INSERT INTO users (name, email, password, role, is_verified) VALUES (?, ?, ?, ?, 1)',
    [
      `Notif Test ${label}`,
      `notif-test-${label}-${Date.now()}@example.invalid`,
      'not-a-real-password-hash',
      'patient',
    ],
  );
  return result.insertId;
};

const tokenFor = (id, role = 'patient') =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '15m' });

const api = async (path, { token, method = 'GET' } = {}) => {
  const response = await realFetch(`${baseUrl}/api/notifications${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, raw: text };
};

const insertNotification = async (userId, { read = false } = {}) => {
  const [result] = await db.query(
    'INSERT INTO notifications (user_id, type, payload, read_at) VALUES (?, ?, ?, ?)',
    [
      userId,
      NOTIFICATION_TYPE.WAITLIST_SLOT_OPEN,
      JSON.stringify({ doctor_name: `Dr. For ${userId}`, date: '2032-04-01' }),
      read ? new Date() : null,
    ],
  );
  return result.insertId;
};

const readAtOf = async (id) => {
  const [[row]] = await db.query('SELECT read_at FROM notifications WHERE id = ?', [id]);
  return row?.read_at ?? null;
};

before(async () => {
  const dbHost = process.env.DB_HOST || '';
  if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
    throw new Error(
      `Refusing to run tests: DB_HOST is "${dbHost}", not localhost.`,
    );
  }

  await connectDB();
  db = getDB();

  patientA = await makePatient('A');
  patientB = await makePatient('B');

  const [[doctorUser]] = await db.query(
    "SELECT id FROM users WHERE role = 'patient' ORDER BY id LIMIT 1",
  );
  doctorUserId = doctorUser.id;

  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationRoutes);

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // CASCADE removes their notifications.
  await db.query('DELETE FROM users WHERE id IN (?, ?)', [patientA, patientB]);
  await db.end();
});

const clear = async () => {
  await db.query('DELETE FROM notifications WHERE user_id IN (?, ?)', [
    patientA,
    patientB,
  ]);
};

beforeEach(clear);
afterEach(clear);

// --- scoping ----------------------------------------------------------------

test('the list returns only the caller’s own notifications', async () => {
  await insertNotification(patientA);
  await insertNotification(patientA);
  await insertNotification(patientB);

  const asA = await api('/', { token: tokenFor(patientA) });
  const asB = await api('/', { token: tokenFor(patientB) });

  assert.equal(asA.body.notifications.length, 2);
  assert.equal(asB.body.notifications.length, 1);

  // B's notification names a different doctor, so a leak is visible.
  assert.ok(!asA.raw.includes(`Dr. For ${patientB}`));
  assert.ok(!asB.raw.includes(`Dr. For ${patientA}`));
});

test('the unread count is scoped to the caller', async () => {
  await insertNotification(patientA);
  await insertNotification(patientA);
  await insertNotification(patientA, { read: true });
  await insertNotification(patientB);

  const asA = await api('/unread-count', { token: tokenFor(patientA) });
  const asB = await api('/unread-count', { token: tokenFor(patientB) });

  assert.equal(asA.body.unreadCount, 2, 'the read one must not be counted');
  assert.equal(asB.body.unreadCount, 1);
});

test('one patient cannot mark another patient’s notification read', async () => {
  const belongingToB = await insertNotification(patientB);

  const response = await api(`/${belongingToB}/read`, {
    token: tokenFor(patientA),
    method: 'PATCH',
  });

  // The response is a deliberate non-answer: 200, and a count of A's own
  // unread. It does not confirm whether that id exists.
  assert.equal(response.status, 200);
  assert.equal(response.body.unreadCount, 0);

  // The assertion that matters — read B's row directly rather than trusting
  // what A was told.
  assert.equal(
    await readAtOf(belongingToB),
    null,
    "patient B's notification was modified by patient A",
  );
});

test('read-all clears only the caller’s notifications', async () => {
  await insertNotification(patientA);
  await insertNotification(patientA);
  const bFirst = await insertNotification(patientB);
  const bSecond = await insertNotification(patientB);

  const response = await api('/read-all', {
    token: tokenFor(patientA),
    method: 'PATCH',
  });

  assert.equal(response.body.marked, 2);
  assert.equal(response.body.unreadCount, 0);

  assert.equal(await readAtOf(bFirst), null, "B's notifications were cleared by A");
  assert.equal(await readAtOf(bSecond), null);
});

// --- behaviour --------------------------------------------------------------

test('marking your own notification read decrements the count', async () => {
  const first = await insertNotification(patientA);
  await insertNotification(patientA);

  const response = await api(`/${first}/read`, {
    token: tokenFor(patientA),
    method: 'PATCH',
  });

  assert.equal(response.body.unreadCount, 1);
  assert.ok(await readAtOf(first), 'read_at should now be a timestamp');
});

test('marking an already-read notification does not move its timestamp', async () => {
  const id = await insertNotification(patientA);

  // Backdated to a fixed instant rather than marking it twice in quick
  // succession. NOW() has second precision, so two marks inside the same
  // second produce an identical timestamp and the assertion below would pass
  // even with the `read_at IS NULL` guard removed — which is exactly what a
  // mutation test caught. A known past value cannot be reproduced by NOW().
  const originallyReadAt = '2020-01-01 00:00:00';
  await db.query('UPDATE notifications SET read_at = ? WHERE id = ?', [
    originallyReadAt,
    id,
  ]);

  const response = await api(`/${id}/read`, {
    token: tokenFor(patientA),
    method: 'PATCH',
  });

  assert.equal(response.status, 200, 'idempotent, not an error');
  assert.equal(response.body.unreadCount, 0);

  const [[row]] = await db.query(
    "SELECT DATE_FORMAT(read_at, '%Y-%m-%d %H:%i:%s') AS read_at FROM notifications WHERE id = ?",
    [id],
  );
  assert.equal(
    row.read_at,
    originallyReadAt,
    'a second mark overwrote the original read time',
  );
});

test('a non-existent id is answered the same way as someone else’s', async () => {
  await insertNotification(patientA);
  const token = tokenFor(patientA);

  const missing = await api('/99999999/read', { token, method: 'PATCH' });

  // Identical shape to the cross-user case above. A 404 here would confirm
  // which notification ids exist.
  assert.equal(missing.status, 200);
  assert.equal(missing.body.unreadCount, 1);
});

test('a malformed id is rejected before it reaches the database', async () => {
  const bad = await api('/not-a-number/read', {
    token: tokenFor(patientA),
    method: 'PATCH',
  });

  assert.equal(bad.status, 400);
});

// --- the door ---------------------------------------------------------------

test('every route requires a patient token', async () => {
  const routes = [
    ['/', 'GET'],
    ['/unread-count', 'GET'],
    ['/1/read', 'PATCH'],
    ['/read-all', 'PATCH'],
  ];

  for (const [path, method] of routes) {
    const anonymous = await api(path, { method });
    assert.equal(anonymous.status, 401, `${method} ${path} unauthenticated`);

    const asDoctor = await api(path, { token: tokenFor(doctorUserId, 'doctor'), method });
    assert.equal(asDoctor.status, 403, `${method} ${path} with a doctor token`);
  }
});

// --- shape and cost ---------------------------------------------------------

test('no response body carries a user_id', async () => {
  await insertNotification(patientA);
  const token = tokenFor(patientA);

  const bodies = [
    (await api('/', { token })).raw,
    (await api('/unread-count', { token })).raw,
    (await api('/read-all', { token, method: 'PATCH' })).raw,
  ];

  for (const body of bodies) {
    assert.ok(!body.includes('user_id'), `user_id leaked in: ${body.slice(0, 120)}`);
  }
});

test('the payload arrives as an object the UI can render', async () => {
  await insertNotification(patientA);

  const { body } = await api('/', { token: tokenFor(patientA) });
  const [notification] = body.notifications;

  assert.equal(notification.type, NOTIFICATION_TYPE.WAITLIST_SLOT_OPEN);
  assert.equal(typeof notification.payload, 'object');
  assert.equal(notification.payload.date, '2032-04-01');
  assert.equal(notification.read_at, null);
});

test('the polled count uses its index rather than scanning', async () => {
  await insertNotification(patientA);

  // This runs every 30 seconds from every open tab, so a table scan here is
  // the difference between free and expensive.
  const [plan] = await db.query(
    'EXPLAIN SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [patientA],
  );

  assert.equal(
    plan[0].key,
    'idx_unread',
    `expected idx_unread, got ${plan[0].key} (type ${plan[0].type})`,
  );
});
