import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { connectDB, getDB } from '../src/config/mysql.js';
import * as appointmentService from '../src/appointments/services/appointmentService.js';
import checkAvailability from '../src/assistant/tools/checkAvailability.js';
import { APPOINTMENT_STATUS } from '../src/constants/appointmentStatus.js';

// The check_availability handler, which had no suite of its own until 7.3.
//
// It was covered only sideways: the guardrail sweep called it to prove no
// banned field appears in a result, and clientCards.test.js exercised the card
// PROJECTION of a hand-written fixture. Neither touched the date-in-past
// guard, the not-accepting branch, or the multi-day loop — and 7.3 changes
// what every one of them returns.

let db;
let doctorId;
let patientId;
let createdAppointmentId = null;

const ctx = { userId: 0, role: 'patient' };

const pad = (n) => String(n).padStart(2, '0');
const dayOffset = (n) => {
  const date = new Date();
  date.setDate(date.getDate() + n);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// Far enough ahead that the "today" branch in getAvailableSlots, which trims
// slots already past, never applies and the grid is whole.
const FUTURE = dayOffset(3);
const PAST = dayOffset(-3);

before(async () => {
  // The same localhost guard every write-touching suite carries: this one
  // inserts and deletes an appointment and flips a doctor's availability.
  const dbHost = process.env.DB_HOST || '';
  if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
    throw new Error(
      `Refusing to run tests: DB_HOST is "${dbHost}", not localhost.`,
    );
  }

  await connectDB();
  db = getDB();

  const [[doctor]] = await db.query(
    'SELECT id FROM doctors WHERE available = TRUE ORDER BY id LIMIT 1',
  );
  const [[patient]] = await db.query(
    "SELECT id FROM users WHERE role IN ('patient','user') ORDER BY id LIMIT 1",
  );

  doctorId = doctor.id;
  patientId = patient.id;
});

after(async () => {
  if (createdAppointmentId) {
    await db.query('DELETE FROM appointments WHERE id = ?', [
      createdAppointmentId,
    ]);
  }
  await db.query('UPDATE doctors SET available = TRUE WHERE id = ?', [doctorId]);
  // Without this the pool keeps the process alive and `node --test` never
  // exits — the same teardown every other suite here does.
  await db.end();
});

const call = (args) => checkAvailability.handler(ctx, args);

test('free_times is exactly what the booking page would offer', async () => {
  const result = await call({ doctor_id: doctorId, date: FUTURE });
  const slots = await appointmentService.getAvailableSlots(doctorId, FUTURE);

  // Same source, so the assistant and the booking page cannot disagree about
  // what is free.
  assert.deepEqual(result.dates[0].free_times, slots);
});

test('the count and the list always agree', async () => {
  const result = await call({ doctor_id: doctorId, date: FUTURE, days: 5 });

  assert.equal(result.dates.length, 5);
  for (const day of result.dates) {
    assert.equal(
      day.free_times.length,
      day.free_slot_count,
      `${day.date}: count ${day.free_slot_count} but ${day.free_times.length} times`,
    );
  }
});

test('a booked slot disappears from free_times, its neighbours do not', async () => {
  const before = await call({ doctor_id: doctorId, date: FUTURE });
  const target = before.dates[0].free_times[2];
  assert.ok(target, 'the fixture needs at least three free slots');

  // Book it, in 24-hour form, the way the booking endpoint would.
  const [hhmm, meridiem] = target.split(' ');
  const [rawHour, minutes] = hhmm.split(':');
  let hour = Number(rawHour) % 12;
  if (meridiem === 'PM') hour += 12;
  const time24 = `${pad(hour)}:${minutes}:00`;

  const [result] = await db.query(
    `INSERT INTO appointments (user_id, doctor_id, appointment_date, appointment_time, status, amount)
     VALUES (?, ?, ?, ?, ?, 50)`,
    [patientId, doctorId, FUTURE, time24, APPOINTMENT_STATUS.PENDING],
  );
  createdAppointmentId = result.insertId;

  const after = await call({ doctor_id: doctorId, date: FUTURE });

  assert.ok(
    !after.dates[0].free_times.includes(target),
    `${target} was booked and must not be offered`,
  );
  assert.equal(after.dates[0].free_slot_count, before.dates[0].free_slot_count - 1);

  // The slots either side are untouched — the removal is precise, not a
  // wholesale collapse of the day.
  for (const neighbour of [
    before.dates[0].free_times[1],
    before.dates[0].free_times[3],
  ]) {
    if (neighbour) {
      assert.ok(after.dates[0].free_times.includes(neighbour));
    }
  }

  await db.query('DELETE FROM appointments WHERE id = ?', [createdAppointmentId]);
  createdAppointmentId = null;
});

test('a past date offers nothing and says why', async () => {
  const result = await call({ doctor_id: doctorId, date: PAST });

  assert.deepEqual(result.dates[0], {
    date: PAST,
    available: false,
    free_slot_count: 0,
    free_times: [],
    reason: 'date_in_past',
  });
});

test('checked_at travels on every branch, including the empty ones', async () => {
  // Rule 7. Naming times makes a result read as settled, so the timestamp has
  // to be there whether or not anything is free.
  const future = await call({ doctor_id: doctorId, date: FUTURE });
  const past = await call({ doctor_id: doctorId, date: PAST });

  for (const result of [future, past]) {
    assert.match(result.checked_at, /^\d{4}-\d{2}-\d{2}T/);
  }
});

test('a doctor who is not accepting returns no dates at all', async () => {
  await db.query('UPDATE doctors SET available = FALSE WHERE id = ?', [doctorId]);

  try {
    const result = await call({ doctor_id: doctorId, date: FUTURE, days: 3 });

    assert.equal(result.accepting_appointments, false);
    assert.deepEqual(result.dates, []);
    assert.match(result.checked_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await db.query('UPDATE doctors SET available = TRUE WHERE id = ?', [doctorId]);
  }
});

test('an unknown doctor returns null rather than an empty day', async () => {
  assert.equal(await call({ doctor_id: 99999999, date: FUTURE }), null);
});

test('free_times carries times and nothing about who booked', async () => {
  const result = await call({ doctor_id: doctorId, date: FUTURE });

  // Rule 4 at the shape level: strings on a clock, not objects that could
  // acquire a patient name later.
  for (const time of result.dates[0].free_times) {
    assert.equal(typeof time, 'string');
    assert.match(time, /^\d{2}:\d{2} (AM|PM)$/);
  }
});
