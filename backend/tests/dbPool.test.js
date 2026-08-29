import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { errorHandler } from '../src/middleware/errorHandler.js';
import { databaseReady } from '../src/middleware/databaseReady.js';
import {
  connectDB,
  getDB,
  isDBReady,
  probeDB,
  refreshReadiness,
  noteConnectionFailure,
  isConnectionError,
  CONNECTION_LIMIT,
} from '../src/config/mysql.js';

// The connection pool (6.6).
//
// The claim is that a dropped database connection stops being fatal, and the
// only way to show that is to actually drop one. These tests STOP AND START a
// MySQL container, so they are opt-in: `DB_RECOVERY_TEST=1`, the same shape
// redisStores.test.js uses. A normal `npm test` and CI skip them.
//
// Point them at a THROWAWAY container, never the working database: the test
// stops whatever `DB_RECOVERY_CONTAINER` names.

const ENABLED = process.env.DB_RECOVERY_TEST === '1';
const CONTAINER = process.env.DB_RECOVERY_CONTAINER || 'prescripto-ci-mysql';

const skip = ENABLED
  ? false
  : 'set DB_RECOVERY_TEST=1 (and point DB_* at a throwaway container) to run';

const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const waitFor = async (predicate, { timeoutMs = 60000, everyMs = 500, label }) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
};

before(async () => {
  if (!ENABLED) return;

  const host = process.env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`Refusing to run: DB_HOST is "${host}", not localhost.`);
  }
  // The guard that matters most here: this suite STOPS a container, so it must
  // never be aimed at anything but a disposable one.
  if (String(process.env.DB_NAME) !== 'prescripto_ci') {
    throw new Error(
      `Refusing to run: DB_NAME is "${process.env.DB_NAME}", not the ` +
        'throwaway prescripto_ci. This suite stops the database container.',
    );
  }

  await connectDB();
});

after(async () => {
  if (!ENABLED) return;
  // Leave the container running for whatever comes next.
  try {
    docker('start', CONTAINER);
  } catch {
    /* already running */
  }
  await getDB().end();
});

// --- pure logic, no container needed ----------------------------------------

test('only connection-level errors count as the database being unreachable', () => {
  assert.equal(isConnectionError({ code: 'ECONNREFUSED' }), true);
  assert.equal(isConnectionError({ code: 'PROTOCOL_CONNECTION_LOST' }), true);
  assert.equal(isConnectionError({ fatal: true }), true);

  // A duplicate key means the database answered perfectly well. Treating it as
  // an outage would take the app down for a booking collision.
  assert.equal(isConnectionError({ code: 'ER_DUP_ENTRY' }), false);
  assert.equal(isConnectionError({ code: 'ER_BAD_FIELD_ERROR' }), false);
  assert.equal(isConnectionError(new Error('nope')), false);
  assert.equal(isConnectionError(null), false);
});

test('noteConnectionFailure reports whether it acted', async () => {
  assert.equal(noteConnectionFailure({ code: 'ER_DUP_ENTRY' }), false);
  assert.equal(noteConnectionFailure({ code: 'ECONNREFUSED' }), true);

  // That second call FLIPPED READINESS, which is the point of the function —
  // and it is module state the tests below depend on. Left unrestored it made
  // them fail on a flag this test set, not on anything they were testing.
  // A test that mutates shared state has to put it back.
  if (ENABLED) await probeDB();
});

// --- the WIRING, not just the function --------------------------------------
//
// The outage test below calls noteConnectionFailure itself. That proves the
// function works; it says nothing about whether anything CALLS it. These two
// go through the real middleware, so removing the call from the error handler
// fails a test instead of silently un-fixing half the increment.

const fakeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.set = () => res;
  return res;
};

test('the error handler turns a connection failure into a 503', () => {
  const res = fakeRes();

  errorHandler({ code: 'ECONNREFUSED', message: 'nope' }, {}, res, () => {});

  assert.equal(res.statusCode, 503, 'an unreachable database is a 503, not a 500');
  assert.equal(isDBReady(), false, 'and it must mark the database not-ready');
});

test('the error handler leaves ordinary SQL errors alone', async () => {
  if (ENABLED) await probeDB();
  const wasReady = isDBReady();

  const res = fakeRes();
  errorHandler({ code: 'ER_DUP_ENTRY', message: 'duplicate' }, {}, res, () => {});

  // A booking collision must not be reported as an outage, nor take readiness
  // down with it.
  assert.notEqual(res.statusCode, 503);
  assert.equal(isDBReady(), wasReady);
});

test('the gate answers 503 while the database is down', { skip }, async () => {
  noteConnectionFailure({ code: 'ECONNREFUSED' });
  assert.equal(isDBReady(), false, 'precondition');

  // Stopped container: the re-probe inside databaseReady must fail and the
  // gate must refuse rather than let the request through to a 500.
  docker('stop', CONTAINER);
  try {
    const res = fakeRes();
    let nexted = false;
    await databaseReady({}, res, () => {
      nexted = true;
    });

    assert.equal(nexted, false, 'the request must not reach a handler');
    assert.equal(res.statusCode, 503);
  } finally {
    docker('start', CONTAINER);
    await waitFor(() => probeDB(), {
      timeoutMs: 90000,
      label: 'the database to come back for the remaining tests',
    });
  }
});

// --- the increment ----------------------------------------------------------

test('a query works before anything is broken', { skip }, async () => {
  const [rows] = await getDB().query('SELECT 1 AS ok');
  assert.equal(rows[0].ok, 1);
  assert.equal(isDBReady(), true);
});

test('the pool SURVIVES the database going away and coming back', { skip }, async () => {
  const db = getDB();

  // 1. healthy
  await db.query('SELECT 1');
  assert.equal(isDBReady(), true, 'precondition: ready');

  // 2. the database goes away
  docker('stop', CONTAINER);

  let failure;
  await waitFor(
    async () => {
      try {
        await db.query('SELECT 1');
        return false;
      } catch (error) {
        failure = error;
        return true;
      }
    },
    { timeoutMs: 30000, label: 'queries to start failing' },
  );

  assert.ok(
    isConnectionError(failure),
    `expected a connection-level failure, got ${failure?.code ?? failure?.message}`,
  );

  // The error handler is what does this in the running app.
  noteConnectionFailure(failure);
  assert.equal(isDBReady(), false, 'readiness must go FALSE during an outage');

  // 3. it comes back — and the SAME Node process recovers, with no restart.
  //    This is precisely what createConnection could not do.
  docker('start', CONTAINER);

  await waitFor(
    async () => {
      try {
        const [rows] = await db.query('SELECT 1 AS ok');
        return rows[0].ok === 1;
      } catch {
        return false;
      }
    },
    { timeoutMs: 90000, label: 'the pool to recover after the database returned' },
  );

  assert.equal(
    await refreshReadiness(Date.now() + 10_000),
    true,
    'readiness must return to true once the database answers again',
  );
  assert.equal(isDBReady(), true);
});

test('the pool serves queries concurrently', { skip }, async () => {
  // A single connection serialises: mysql2 queues statements on one socket.
  // SLEEP(0.3) x 12 would take ~3.6s serialised and ~0.3-0.6s across a pool of
  // ten. Asserted with a generous ceiling so this measures parallelism rather
  // than the machine's mood.
  const db = getDB();
  assert.ok(CONNECTION_LIMIT >= 10);

  const started = Date.now();
  await Promise.all(
    Array.from({ length: 12 }, () => db.query('SELECT SLEEP(0.3)')),
  );
  const elapsed = Date.now() - started;

  assert.ok(
    elapsed < 2000,
    `12 concurrent 0.3s queries took ${elapsed}ms — that is serialised, not pooled`,
  );
});

test('probeDB reports reachability directly', { skip }, async () => {
  assert.equal(await probeDB(), true);
});
