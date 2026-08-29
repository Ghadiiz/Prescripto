import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { connectDB, getDB } from '../src/config/mysql.js';
import * as appointmentService from '../src/appointments/services/appointmentService.js';
import { convertTo12Hour } from '../src/appointments/services/appointmentService.js';
import * as doctorAppointmentService from '../src/doctors/services/doctorAppointmentService.js';
import { notifyWaitlistForFreedSlot } from '../src/notifications/services/waitlistNotifier.js';
import { APPOINTMENT_STATUS } from '../src/constants/appointmentStatus.js';

// Cancellations feeding the waitlist.
//
// These go through the real cancel SERVICES, not the notifier alone, because
// the thing 5.4 adds is the connection between them — and there are two cancel
// paths that share no model function, so testing one proves nothing about the
// other.

let db;
let waiter;
let otherWaiter;
let booker;
let doctorId;
let otherDoctorId;

// Far future so nothing collides with real or seeded rows, and so the
// "not in the past" guard never trips accidentally.
const daysAhead = (n) => {
  const date = new Date();
  date.setDate(date.getDate() + n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const SLOT_DATE = daysAhead(20);
const WINDOW_FROM = daysAhead(18);
const WINDOW_TO = daysAhead(25);

let slotTime = 10;

const makePatient = async (label) => {
  const [result] = await db.query(
    'INSERT INTO users (name, email, password, role, is_verified) VALUES (?, ?, ?, ?, 1)',
    [
      `Notifier ${label}`,
      `notifier-${label}-${Date.now()}-${Math.random()}@example.invalid`,
      'not-a-real-password-hash',
      'patient',
    ],
  );
  return result.insertId;
};

// Unique time per appointment so active_slot's unique index never collides.
const bookAppointment = async (userId, doctorIdArg = doctorId, date = SLOT_DATE) => {
  slotTime += 1;
  const [result] = await db.query(
    `INSERT INTO appointments (user_id, doctor_id, appointment_date, appointment_time, status, amount)
     VALUES (?, ?, ?, ?, ?, 50)`,
    [userId, doctorIdArg, date, `${String(slotTime).padStart(2, '0')}:00:00`, APPOINTMENT_STATUS.PENDING],
  );
  return result.insertId;
};

const addWaitlist = async (userId, { from = WINDOW_FROM, to = WINDOW_TO, status = 'active', doctor = doctorId } = {}) => {
  const [result] = await db.query(
    'INSERT INTO waitlist (user_id, doctor_id, date_from, date_to, status) VALUES (?, ?, ?, ?, ?)',
    [userId, doctor, from, to, status],
  );
  return result.insertId;
};

const notificationsFor = async (userId) => {
  const [rows] = await db.query(
    'SELECT type, payload, read_at FROM notifications WHERE user_id = ? ORDER BY id',
    [userId],
  );
  return rows;
};

before(async () => {
  const dbHost = process.env.DB_HOST || '';
  if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
    throw new Error(`Refusing to run tests: DB_HOST is "${dbHost}", not localhost.`);
  }

  // This suite pins the INLINE notification path, and 6.2 gave the notifier a
  // second one: with REDIS_URL set, a cancellation ENQUEUES and the row does
  // not exist until a worker runs, so every assertion here about a
  // notification arriving during the cancel would fail.
  //
  // Unsetting it makes that explicit rather than leaving the file quietly
  // dependent on whether the developer happens to have Redis configured. This
  // is 6.1's DISABLED state — the fallback 6.2 must preserve — and keeping a
  // suite on it is the regression proof that the app still works with no
  // Redis at all. The queued path has its own suite in waitlistQueue.test.js.
  //
  // Safe to mutate: each test file is its own process, and 6.1 reads
  // REDIS_URL at call time rather than capturing it at import.
  delete process.env.REDIS_URL;

  await connectDB();
  db = getDB();

  waiter = await makePatient('waiter');
  otherWaiter = await makePatient('other');
  booker = await makePatient('booker');

  const [doctors] = await db.query(
    'SELECT id FROM doctors WHERE available = 1 ORDER BY id LIMIT 2',
  );
  doctorId = doctors[0].id;
  otherDoctorId = doctors[1].id;
});

after(async () => {
  await db.query('DELETE FROM users WHERE id IN (?, ?, ?)', [
    waiter,
    otherWaiter,
    booker,
  ]);
  await db.end();
});

const clear = async () => {
  const ids = [waiter, otherWaiter, booker];
  await db.query('DELETE FROM notifications WHERE user_id IN (?)', [ids]);
  await db.query('DELETE FROM waitlist WHERE user_id IN (?)', [ids]);
  await db.query('DELETE FROM appointments WHERE user_id IN (?)', [ids]);
};

beforeEach(clear);
afterEach(clear);

// --- both paths, because there are two -------------------------------------

test('a PATIENT cancelling notifies the waiting patient', async () => {
  await addWaitlist(waiter);
  const appointmentId = await bookAppointment(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, 'changed my mind');

  const notifications = await notificationsFor(waiter);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'waitlist_slot_open');
  assert.equal(notifications[0].payload.date, SLOT_DATE);
  assert.equal(notifications[0].read_at, null, 'it should arrive unread');
});

test('a DOCTOR cancelling notifies the waiting patient too', async () => {
  // The path that would stay silent if only the patient service were hooked —
  // and arguably the more common reason a slot opens.
  await addWaitlist(waiter);
  const appointmentId = await bookAppointment(booker);

  await doctorAppointmentService.cancelAppointment(appointmentId, doctorId);

  const notifications = await notificationsFor(waiter);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].payload.date, SLOT_DATE);
});

// --- the failure that must not propagate ------------------------------------

test('a broken notifier cannot fail a cancellation', async () => {
  await addWaitlist(waiter);
  const appointmentId = await bookAppointment(booker);

  // Stubbed at the DB layer, not by reassigning the export: an ESM module
  // namespace is immutable, so Object.defineProperty on it throws "Cannot
  // redefine property". Failing the INSERT is also closer to the real failure
  // being simulated — a database blip, not a missing function.
  const original = db.query.bind(db);
  db.query = async (sql, params) => {
    if (typeof sql === 'string' && sql.includes('INSERT INTO notifications')) {
      throw new Error('simulated notification failure');
    }
    return original(sql, params);
  };

  try {
    // The appointment is already cancelled by the time notification runs.
    // Throwing here would report failure for something that succeeded.
    const result = await appointmentService.cancelAppointment(
      appointmentId,
      booker,
      'testing',
    );
    assert.match(result.message, /cancelled successfully/i);
  } finally {
    db.query = original;
  }

  const [[row]] = await db.query('SELECT status FROM appointments WHERE id = ?', [
    appointmentId,
  ]);
  assert.equal(row.status, APPOINTMENT_STATUS.CANCELLED, 'the cancel must stand');
  assert.equal((await notificationsFor(waiter)).length, 0, 'and the notice is lost');
});

// --- who is and is not told --------------------------------------------------

test('a window that does not cover the freed date is not notified', async () => {
  await addWaitlist(waiter, { from: daysAhead(40), to: daysAhead(45) });
  const appointmentId = await bookAppointment(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  assert.equal((await notificationsFor(waiter)).length, 0);
});

test('a cancelled waitlist row is not notified', async () => {
  await addWaitlist(waiter, { status: 'cancelled' });
  const appointmentId = await bookAppointment(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  assert.equal((await notificationsFor(waiter)).length, 0);
});

test('a waitlist for a different doctor is not notified', async () => {
  await addWaitlist(waiter, { doctor: otherDoctorId });
  const appointmentId = await bookAppointment(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  assert.equal((await notificationsFor(waiter)).length, 0);
});

test('the patient who cancelled is not told about their own freed slot', async () => {
  // booker is waiting on the same doctor AND cancels their own appointment.
  await addWaitlist(booker);
  await addWaitlist(waiter);
  const appointmentId = await bookAppointment(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  assert.equal((await notificationsFor(booker)).length, 0, 'they freed it on purpose');
  assert.equal((await notificationsFor(waiter)).length, 1, 'but others still hear');
});

test('a past-dated cancellation notifies nobody', async () => {
  const pastDate = daysAhead(-5);
  await addWaitlist(waiter, { from: daysAhead(-10), to: daysAhead(30) });
  const appointmentId = await bookAppointment(booker, doctorId, pastDate);

  await notifyWaitlistForFreedSlot({ doctorId, date: pastDate });

  assert.equal((await notificationsFor(waiter)).length, 0);
  void appointmentId;
});

// --- one notification per freed date -----------------------------------------

test('overlapping windows for one patient produce ONE notification', async () => {
  // 006's unique key is on the exact tuple, so both of these are legitimate
  // rows and both match the freed date.
  await addWaitlist(waiter, { from: WINDOW_FROM, to: WINDOW_TO });
  await addWaitlist(waiter, { from: daysAhead(19), to: daysAhead(30) });
  const appointmentId = await bookAppointment(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  assert.equal(
    (await notificationsFor(waiter)).length,
    1,
    'two matching rows for one patient is still one freed slot',
  );
});

test('an unread notice for the same doctor and date is not stacked', async () => {
  await addWaitlist(waiter);

  const first = await bookAppointment(booker);
  await appointmentService.cancelAppointment(first, booker, null);

  const second = await bookAppointment(otherWaiter);
  await appointmentService.cancelAppointment(second, otherWaiter, null);

  assert.equal(
    (await notificationsFor(waiter)).length,
    1,
    'they had not read the first one yet',
  );
});

test('several waiting patients are each notified once', async () => {
  await addWaitlist(waiter);
  await addWaitlist(otherWaiter);
  const appointmentId = await bookAppointment(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  assert.equal((await notificationsFor(waiter)).length, 1);
  assert.equal((await notificationsFor(otherWaiter)).length, 1);
});

// --- shape and cost ----------------------------------------------------------

test('the payload carries what the bell renders, sanitised', async () => {
  await addWaitlist(waiter);
  const appointmentId = await bookAppointment(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  const [{ payload }] = await notificationsFor(waiter);

  assert.equal(typeof payload, 'object');
  assert.equal(payload.doctor_id, doctorId);
  assert.equal(payload.date, SLOT_DATE);
  assert.equal(typeof payload.doctor_name, 'string');

  // sanitizeAdminText strips control and format characters from admin-editable
  // text before it reaches a patient's screen.
  assert.ok(!/[\p{Cc}\p{Cf}]/u.test(payload.doctor_name));
});

// --- 7.2: the freed TIME ------------------------------------------------------

test('the payload names the freed time in the booking grid format', async () => {
  await addWaitlist(waiter);
  const appointmentId = await bookAppointment(booker);

  const [[booked]] = await db.query(
    'SELECT appointment_time FROM appointments WHERE id = ?',
    [appointmentId],
  );

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  const [{ payload }] = await notificationsFor(waiter);

  // The SAME string the booking page shows, because both come from
  // appointmentService.convertTo12Hour. A separate formatter here would be a
  // second source of truth that could drift.
  assert.equal(payload.slot_time, convertTo12Hour(booked.appointment_time));
  assert.match(payload.slot_time, /^\d{2}:\d{2} (AM|PM)$/);
});

test('the DOCTOR cancel path names the time too', async () => {
  await addWaitlist(waiter);
  const appointmentId = await bookAppointment(booker);

  const [[booked]] = await db.query(
    'SELECT appointment_time FROM appointments WHERE id = ?',
    [appointmentId],
  );

  await doctorAppointmentService.cancelAppointment(appointmentId, doctorId);

  const [{ payload }] = await notificationsFor(waiter);

  assert.equal(payload.slot_time, convertTo12Hour(booked.appointment_time));
});

test('a notification with no time is still written', async () => {
  // The deploy straddle: a job enqueued before 7.2 reaches the new worker with
  // no `time`, and the notifier is called directly by that worker.
  await addWaitlist(waiter);

  await notifyWaitlistForFreedSlot({ doctorId, date: SLOT_DATE });

  const [{ payload }] = await notificationsFor(waiter);

  assert.equal(payload.date, SLOT_DATE);
  assert.ok(
    !('slot_time' in payload),
    'the key is omitted rather than set to null, so old and new read alike',
  );
});

test('an already-formatted time is not formatted twice', async () => {
  // The queued path normalises when building the job payload and the worker
  // hands the result back in. Converting '10:30 AM' again would yield
  // '10:30 AM AM'.
  await addWaitlist(waiter);

  await notifyWaitlistForFreedSlot({
    doctorId,
    date: SLOT_DATE,
    time: '10:30 AM',
  });

  const [{ payload }] = await notificationsFor(waiter);

  assert.equal(payload.slot_time, '10:30 AM');
});

test('a time that is not a time is dropped rather than rendered', async () => {
  await addWaitlist(waiter);

  await notifyWaitlistForFreedSlot({
    doctorId,
    date: SLOT_DATE,
    time: 'whenever',
  });

  const [{ payload }] = await notificationsFor(waiter);

  assert.ok(!('slot_time' in payload));
});

test('the waitlist match uses idx_match rather than scanning', async () => {
  // This runs inside a cancellation, which a patient is waiting on.
  const [plan] = await db.query(
    `EXPLAIN SELECT id, user_id, date_from, date_to
       FROM waitlist
      WHERE doctor_id = ? AND status = 'active'
        AND date_from <= ? AND date_to >= ?`,
    [doctorId, SLOT_DATE, SLOT_DATE],
  );

  assert.equal(
    plan[0].key,
    'idx_match',
    `expected idx_match, got ${plan[0].key} (type ${plan[0].type})`,
  );
});

test('the waitlist row stays active so the patient keeps waiting', async () => {
  const waitlistId = await addWaitlist(waiter);
  const appointmentId = await bookAppointment(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  const [[row]] = await db.query('SELECT status FROM waitlist WHERE id = ?', [
    waitlistId,
  ]);
  assert.equal(
    row.status,
    'active',
    'a patient who misses this slot must still hear about the next one',
  );
});
