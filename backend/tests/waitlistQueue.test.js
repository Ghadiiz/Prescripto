import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Worker } from 'bullmq';

import { connectDB, getDB } from '../src/config/mysql.js';
import { closeRedis } from '../src/config/redis.js';
import {
  getWaitlistQueue,
  closeWaitlistQueue,
  WAITLIST_QUEUE_NAME,
  NOTIFY_JOB,
  JOB_OPTIONS,
} from '../src/queue/waitlistQueue.js';
import {
  createQueueConnection,
  createThrottledErrorLogger,
} from '../src/queue/connection.js';
import {
  createWaitlistWorker,
  closeWaitlistWorker,
} from '../src/queue/waitlistWorker.js';
import * as appointmentService from '../src/appointments/services/appointmentService.js';
import * as doctorAppointmentService from '../src/doctors/services/doctorAppointmentService.js';
import { APPOINTMENT_STATUS } from '../src/constants/appointmentStatus.js';

// The durable notification path (6.2).
//
// The complement of waitlistNotifier.test.js, which pins the INLINE path with
// REDIS_URL deliberately unset. This one needs a real Redis, because what it
// asserts — a job existing, being retried, and stopping after its attempts —
// is precisely what an in-memory stub would have to invent.

const ENABLED = Boolean(process.env.REDIS_URL);
const skip = ENABLED
  ? false
  : 'REDIS_URL is not set — start Redis and set it to exercise the queue';

let db;
let waiter;
let booker;
let doctorId;
let otherDoctorId;

const daysAhead = (n) => {
  const date = new Date();
  date.setDate(date.getDate() + n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const SLOT_DATE = daysAhead(21);
let slotTime = 9;

const makePatient = async (label) => {
  const [result] = await db.query(
    'INSERT INTO users (name, email, password, role, is_verified) VALUES (?, ?, ?, ?, 1)',
    [`Queue ${label}`, `queue-${label}-${Date.now()}@example.invalid`, 'x', 'patient'],
  );
  return result.insertId;
};

const book = async (userId, doctor = doctorId) => {
  slotTime += 1;
  const [result] = await db.query(
    `INSERT INTO appointments
       (user_id, doctor_id, appointment_date, appointment_time, status, amount)
     VALUES (?, ?, ?, ?, ?, 50)`,
    [userId, doctor, SLOT_DATE, `${String(slotTime).padStart(2, '0')}:00:00`,
     APPOINTMENT_STATUS.PENDING],
  );
  return result.insertId;
};

const addWaitlist = async (userId, doctor = doctorId) => {
  await db.query(
    'INSERT INTO waitlist (user_id, doctor_id, date_from, date_to, status) VALUES (?, ?, ?, ?, ?)',
    [userId, doctor, daysAhead(18), daysAhead(25), 'active'],
  );
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

  await connectDB();
  db = getDB();

  // Defensive cleanup BEFORE the run, not only after it.
  //
  // These fixtures use a timestamped email, so a process killed before its
  // after() hook leaks a fresh pair of users every time — and the rows they
  // leave behind broke an unrelated suite (doctorTools' "no waitlist row was
  // written" assertion) rather than this one. A suite whose failure mode is
  // someone else's red test is a suite that has to clean up in front of
  // itself.
  const [stale] = await db.query(
    "SELECT id FROM users WHERE email LIKE 'queue-%@example.invalid'",
  );
  const staleIds = stale.map((row) => row.id);

  if (staleIds.length) {
    await db.query('DELETE FROM notifications WHERE user_id IN (?)', [staleIds]);
    await db.query('DELETE FROM waitlist WHERE user_id IN (?)', [staleIds]);
    await db.query('DELETE FROM appointments WHERE user_id IN (?)', [staleIds]);
    await db.query('DELETE FROM users WHERE id IN (?)', [staleIds]);
  }

  const [doctors] = await db.query(
    'SELECT id FROM doctors WHERE available = 1 ORDER BY id LIMIT 2',
  );
  doctorId = doctors[0].id;
  otherDoctorId = doctors[1].id;

  waiter = await makePatient('waiter');
  booker = await makePatient('booker');
});

after(async () => {
  if (db) {
    await db.query('DELETE FROM users WHERE id IN (?, ?)', [waiter, booker]);
    await db.end();
  }
  await closeWaitlistQueue();
  await closeRedis();
});

const clear = async () => {
  const ids = [waiter, booker];
  await db.query('DELETE FROM notifications WHERE user_id IN (?)', [ids]);
  await db.query('DELETE FROM waitlist WHERE user_id IN (?)', [ids]);
  await db.query('DELETE FROM appointments WHERE user_id IN (?)', [ids]);

  const queue = getWaitlistQueue();
  if (queue) await queue.obliterate({ force: true });
};

beforeEach(async () => {
  if (!ENABLED) return;
  await clear();
});

afterEach(async () => {
  if (!ENABLED) return;
  await clear();
});

// Runs ONE job through a real worker and resolves when it settles, so no test
// sleeps hoping the work happened.
const runWorkerOnce = async ({ processor } = {}) => {
  // With no custom processor this runs the REAL createWaitlistWorker.
  //
  // The first version of this helper re-implemented the job body inline, which
  // meant the production worker was never executed by any test: a mutation
  // that made the worker bypass 5.4's dedupe entirely passed 8/8. A test
  // helper that reimplements the thing under test is testing itself.
  let connection = null;
  let worker;

  if (processor) {
    connection = createQueueConnection();
    worker = new Worker(WAITLIST_QUEUE_NAME, processor, {
      connection,
      concurrency: 1,
    });
  } else {
    worker = createWaitlistWorker();
  }

  const settled = new Promise((resolve) => {
    let done = 0;
    const finish = () => {
      done += 1;
      if (done >= 1) resolve();
    };
    worker.on('completed', finish);
    worker.on('failed', (job) => {
      // Only settle once the job has run out of attempts, so a retry test
      // waits for the real end rather than the first stumble.
      if ((job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 1)) finish();
    });
  });

  await settled;

  if (connection) {
    await worker.close();
    // Ours to close: BullMQ does not close a connection it was handed.
    try {
      await connection.quit();
    } catch {
      connection.disconnect();
    }
  } else {
    await closeWaitlistWorker(worker);
  }
};

// --- the error-log throttle --------------------------------------------------
//
// Not skipped: this is pure logic and needs no Redis. It exists because
// BullMQ must retry forever (maxRetriesPerRequest: null is mandatory), so an
// unreachable Redis emitted an error line per attempt — measured at 36 lines
// in 30 seconds against a dead port, roughly 100,000 a day.

test('the connection error log reports transitions, not every retry', () => {
  const lines = [];
  const realError = console.error;
  console.error = (line) => lines.push(line);

  try {
    const log = createThrottledErrorLogger('Test Redis', 1000);
    const boom = { code: 'ECONNREFUSED' };

    // The transition INTO failure is loud.
    log.onError(boom);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /unavailable \(ECONNREFUSED\)/);
    assert.match(lines[0], /at most once every 1s/);

    // Everything inside the window is silent.
    for (let i = 0; i < 50; i += 1) log.onError(boom);
    assert.equal(lines.length, 1, '50 further failures must add no lines');

    // After the window, exactly one line — carrying the suppressed count, so
    // the volume stays visible even though the lines do not.
    const realNow = Date.now;
    Date.now = () => realNow() + 1500;
    try {
      log.onError(boom);
    } finally {
      Date.now = realNow;
    }

    assert.equal(lines.length, 2);
    assert.match(lines[1], /still unavailable/);
    // 51, not 50: the call that trips the interval is itself a failure, and it
    // is being reported by this very line. The count is "failures since the
    // last line", so including it is right.
    assert.match(lines[1], /51 further failures/);

    // Recovery is loud too — it is what makes the silence between safe to read.
    log.onReady();
    assert.equal(lines.length, 3);
    assert.match(lines[2], /available again/);

    // And a fresh outage is a fresh transition, not a throttled continuation.
    log.onError(boom);
    assert.equal(lines.length, 4);
    assert.match(lines[3], /unavailable \(ECONNREFUSED\)/);
  } finally {
    console.error = realError;
  }
});

test('a healthy connection logs nothing at all', () => {
  const lines = [];
  const realError = console.error;
  console.error = (line) => lines.push(line);

  try {
    const log = createThrottledErrorLogger('Test Redis', 1000);
    // onReady without a preceding failure must not announce a recovery that
    // never happened — otherwise every normal boot logs a spurious line.
    log.onReady();
    log.onReady();
    assert.deepEqual(lines, []);
  } finally {
    console.error = realError;
  }
});

// --- the queued path ---------------------------------------------------------

test('a cancellation enqueues rather than notifying inline', { skip }, async () => {
  await addWaitlist(waiter);
  const appointmentId = await book(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  // Nothing yet — the whole point is that the work moved off the request.
  assert.equal(
    (await notificationsFor(waiter)).length,
    0,
    'the notification must not have been written inline',
  );

  const queue = getWaitlistQueue();
  const waiting = await queue.getWaiting();
  assert.equal(waiting.length, 1, 'exactly one job should be queued');
  assert.equal(waiting[0].name, NOTIFY_JOB);

  await runWorkerOnce();

  assert.equal(
    (await notificationsFor(waiter)).length,
    1,
    'and the worker delivers it',
  );
});

test('the DOCTOR cancel path enqueues too', { skip }, async () => {
  await addWaitlist(waiter);
  const appointmentId = await book(booker);

  await doctorAppointmentService.cancelAppointment(appointmentId, doctorId);

  const waiting = await getWaitlistQueue().getWaiting();
  assert.equal(waiting.length, 1, 'the doctor path must queue as well');

  await runWorkerOnce();
  assert.equal((await notificationsFor(waiter)).length, 1);
});

// --- what rests in Redis -----------------------------------------------------

test('the job payload carries identifiers and nothing else', { skip }, async () => {
  await addWaitlist(waiter);
  const appointmentId = await book(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  const [job] = await getWaitlistQueue().getWaiting();

  // Asserted as an exact SET, so adding a patient name or an email to the
  // payload later fails here rather than quietly parking PII in a third
  // party's Redis.
  assert.deepEqual(
    Object.keys(job.data).sort(),
    ['date', 'doctorId', 'excludeUserId'],
  );

  assert.equal(job.data.doctorId, doctorId);
  assert.equal(job.data.excludeUserId, booker);
  // A plain date string, not an ISO timestamp that survived JSON round-tripping.
  assert.match(job.data.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(job.data.date, SLOT_DATE);

  const serialised = JSON.stringify(job.data);
  for (const banned of ['Queue waiter', 'Queue booker', '@example.invalid', 'name']) {
    assert.ok(!serialised.includes(banned), `payload leaked "${banned}"`);
  }
});

// --- retries -----------------------------------------------------------------

test('a retried job does not notify twice', { skip }, async () => {
  await addWaitlist(waiter);
  const appointmentId = await book(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  // Run the SAME job body twice, which is what a retry after a partial
  // failure looks like. 5.4's unread dedupe is what must hold.
  await runWorkerOnce();
  await getWaitlistQueue().add(NOTIFY_JOB, {
    doctorId,
    date: SLOT_DATE,
    excludeUserId: booker,
  }, JOB_OPTIONS);
  await runWorkerOnce();

  assert.equal(
    (await notificationsFor(waiter)).length,
    1,
    'the 5.4 dedupe must still cover the retry path',
  );
});

test('a permanently failing job stops after its attempts', { skip }, async () => {
  await addWaitlist(waiter);
  const appointmentId = await book(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);

  let attempts = 0;

  await runWorkerOnce({
    processor: async () => {
      attempts += 1;
      throw new Error('simulated permanent failure');
    },
  });

  // A LITERAL 3, not JOB_OPTIONS.attempts.
  //
  // Asserting against the imported constant compares the mutation to itself:
  // raising attempts to 25 changed both sides and the test still passed (it
  // only got slower, because of the backoff). The number is part of what this
  // test pins, so it has to be written down here.
  assert.equal(attempts, 3, `expected exactly 3 attempts, got ${attempts}`);
  assert.equal(JOB_OPTIONS.attempts, 3, 'the configured limit must stay 3');

  const failed = await getWaitlistQueue().getFailed();
  assert.equal(failed.length, 1, 'it must land in the failed set, not vanish');

  assert.equal(
    (await notificationsFor(waiter)).length,
    0,
    'and nothing was written',
  );
});

// --- the 5.4 guarantee, under 6.2 --------------------------------------------

test('a cancellation survives an enqueue that throws', { skip }, async () => {
  await addWaitlist(waiter);
  const appointmentId = await book(booker);

  // Break the queue itself, the way a Redis outage would.
  const queue = getWaitlistQueue();
  const realAdd = queue.add.bind(queue);
  queue.add = async () => {
    throw new Error('simulated queue failure');
  };

  try {
    const result = await appointmentService.cancelAppointment(
      appointmentId,
      booker,
      null,
    );
    assert.match(result.message, /cancelled successfully/i);
  } finally {
    queue.add = realAdd;
  }

  const [[row]] = await db.query('SELECT status FROM appointments WHERE id = ?', [
    appointmentId,
  ]);
  assert.equal(row.status, APPOINTMENT_STATUS.CANCELLED, 'the cancel must stand');

  // And it fell back to notifying INLINE rather than losing the notification,
  // which is the rung 5.4 did not have.
  assert.equal(
    (await notificationsFor(waiter)).length,
    1,
    'a broken queue must degrade to inline, not to silence',
  );
});

test('two cancellations on one day queue TWO jobs', { skip }, async () => {
  // The case a deterministic jobId would silently break.
  //
  // Keying jobs on doctor+date looks like helpful deduplication, and it would
  // drop the SECOND cancellation's notification whenever the first job was
  // still within its retention window — a real slot freed, and nobody told.
  // Deduplication belongs in the database, where 5.4 put it, because that is
  // the layer that knows whether the patient has read the first notice.
  await addWaitlist(waiter);

  const first = await book(booker);
  const second = await book(booker);

  await appointmentService.cancelAppointment(first, booker, null);
  await appointmentService.cancelAppointment(second, booker, null);

  const waiting = await getWaitlistQueue().getWaiting();

  assert.equal(
    waiting.length,
    2,
    'each freed slot must get its own job — the queue must not deduplicate',
  );
});

// --- shutdown: the free-tier spin-down scenario ------------------------------
//
// Render's free web service stops when idle, so SIGTERM arrives while a job may
// be mid-processing. The whole durability premise rests on that job not being
// lost, so both halves are pinned here rather than taken on trust.

test('closing the worker WAITS for a job that is mid-flight', { skip }, async () => {
  await addWaitlist(waiter);
  const appointmentId = await book(booker);
  await appointmentService.cancelAppointment(appointmentId, booker, null);

  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  let finished = false;

  const connection = createQueueConnection();
  const worker = new Worker(
    WAITLIST_QUEUE_NAME,
    async (job) => {
      signalStarted();
      // Long enough that close() cannot possibly resolve first by accident.
      await new Promise((resolve) => setTimeout(resolve, 600));
      finished = true;

      const { notifyWaitlistForFreedSlot } = await import(
        '../src/notifications/services/waitlistNotifier.js'
      );
      return notifyWaitlistForFreedSlot(job.data);
    },
    { connection, concurrency: 1 },
  );

  await started; // the job is ACTIVE right now

  // Calls the REAL shutdown function, not worker.close() directly.
  //
  // Testing BullMQ's semantics would prove something about BullMQ; what needs
  // proving is that OUR SIGTERM path uses them. closeWaitlistWorker performs
  // the graceful close() — no `true` argument — so a change to force-close
  // fails here rather than silently making shutdown lossy.
  await closeWaitlistWorker(worker);

  assert.equal(finished, true, 'close() must not return before the job finishes');
  assert.equal(
    (await notificationsFor(waiter)).length,
    1,
    'the in-flight job completed its work',
  );

  try {
    await connection.quit();
  } catch {
    connection.disconnect();
  }
});

test('a job abandoned mid-flight is reprocessed, not lost', { skip }, async () => {
  // The harsher case: SIGKILL after Render's grace period, so nothing waits.
  // close(true) is the closest honest analogue — the process stops caring
  // about the active job. BullMQ must recover it as STALLED.
  await addWaitlist(waiter);
  const appointmentId = await book(booker);
  await appointmentService.cancelAppointment(appointmentId, booker, null);

  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });

  const abandonedConnection = createQueueConnection();
  const abandoned = new Worker(
    WAITLIST_QUEUE_NAME,
    async () => {
      signalStarted();
      // Never resolves: this worker dies holding the job.
      await new Promise(() => {});
    },
    {
      connection: abandonedConnection,
      concurrency: 1,
      // Short so the stall is detected in test time rather than the 30s default.
      lockDuration: 1000,
      stalledInterval: 500,
    },
  );

  await started;
  await abandoned.close(true); // FORCE — the job is left active and locked
  try {
    await abandonedConnection.quit();
  } catch {
    abandonedConnection.disconnect();
  }

  assert.equal(
    (await notificationsFor(waiter)).length,
    0,
    'precondition: the abandoned worker did no work',
  );

  // A fresh worker — the next wake-up — must pick the job back up.
  const recoveryConnection = createQueueConnection();
  const recovered = new Worker(
    WAITLIST_QUEUE_NAME,
    async (job) => {
      const { notifyWaitlistForFreedSlot } = await import(
        '../src/notifications/services/waitlistNotifier.js'
      );
      return notifyWaitlistForFreedSlot(job.data);
    },
    {
      connection: recoveryConnection,
      concurrency: 1,
      lockDuration: 1000,
      stalledInterval: 500,
    },
  );

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the abandoned job was never reprocessed')),
      20000,
    );
    recovered.on('completed', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  await recovered.close();
  try {
    await recoveryConnection.quit();
  } catch {
    recoveryConnection.disconnect();
  }

  assert.equal(
    (await notificationsFor(waiter)).length,
    1,
    'the job survived a worker dying mid-flight',
  );
});

test('a waitlist for another doctor is not queued into a notification', { skip }, async () => {
  await addWaitlist(waiter, otherDoctorId);
  const appointmentId = await book(booker);

  await appointmentService.cancelAppointment(appointmentId, booker, null);
  await runWorkerOnce();

  assert.equal((await notificationsFor(waiter)).length, 0);
});
