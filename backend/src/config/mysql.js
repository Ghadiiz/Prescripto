import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// A POOL, not a single connection (6.6).
//
// Before this the whole app shared one `createConnection`. mysql2 does not
// reconnect on its own, so when that socket dropped — which a sleeping Aiven
// instance and a free-tier Render dyno make routine, not hypothetical — every
// query threw until the process was restarted. A pool replaces dead members
// transparently, which is the entire fix.
//
// Safe as a drop-in because nothing here depends on queries sharing a session:
// there are no transactions, no `LAST_INSERT_ID()` read as a separate
// statement (the code uses `result.insertId`), and no `SET @var`, temporary
// tables or `LOCK TABLES` anywhere in backend/ or mcp/. Checked before the
// change, not assumed after it.

let pool;

// Readiness is exposed so requests arriving before the database is reachable
// are answered with a 503 rather than reaching a query and throwing a 500.
//
// It can now go BACK to false, which is the second half of the bug this
// increment closes: it used to be set true once at startup and never cleared,
// so an outage produced 500s from a gate that still claimed to be ready.
let ready = false;
let lastProbeAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Modest on purpose. Aiven's smallest MySQL plan caps total connections in the
// low tens and that ceiling is shared with anything else connecting — a
// migration run, a psql session, a second instance. Ten is comfortably inside
// it while still being ten times what the app had before.
const CONNECTION_LIMIT = 10;

// How often a not-ready gate is allowed to re-probe. Driven by traffic rather
// than a timer: the codebase avoids setInterval (see conversationStore.js), and
// a probe per request during an outage would add latency to every 503.
const PROBE_INTERVAL_MS = 3000;

const poolOptions = () => ({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: CONNECTION_LIMIT,
  // A burst waits for a free connection instead of erroring.
  queueLimit: 0,
  // Managed databases drop idle connections without saying so. Keepalive is
  // what stops the pool handing out a socket the server has already forgotten.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  ...(process.env.DB_SSL === 'true' && {
    ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
  }),
});

// Connection-level failures, as opposed to "your SQL was wrong".
//
// Only these say anything about whether the DATABASE is reachable. A duplicate
// key or a bad column name means the database answered perfectly well, and
// must not flip readiness.
const CONNECTION_ERROR_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ER_CON_COUNT_ERROR',
  'PROTOCOL_SEQUENCE_TIMEOUT',
]);

export const isConnectionError = (error) =>
  Boolean(error) &&
  (CONNECTION_ERROR_CODES.has(error.code) ||
    CONNECTION_ERROR_CODES.has(error.errno) ||
    error.fatal === true);

// Called from the central error handler, which already sees every thrown error
// — so the readiness flag learns about an outage from real traffic rather than
// from a poll nobody asked for.
export const noteConnectionFailure = (error) => {
  if (!isConnectionError(error)) return false;

  if (ready) {
    console.error(
      `Database appears unreachable (${error.code ?? error.message}). ` +
        'Reporting not-ready until a probe succeeds.',
    );
  }

  ready = false;
  return true;
};

// A cheap liveness check. Returns true and restores readiness on success.
export const probeDB = async () => {
  if (!pool) return false;

  try {
    await pool.query('SELECT 1');
    if (!ready) console.log('Database is reachable again.');
    ready = true;
    return true;
  } catch (error) {
    ready = false;
    return false;
  } finally {
    lastProbeAt = Date.now();
  }
};

// Re-probes at most once per PROBE_INTERVAL_MS, so a burst of requests during
// an outage costs one probe rather than one each.
export const refreshReadiness = async (now = Date.now()) => {
  if (ready) return true;
  if (now - lastProbeAt < PROBE_INTERVAL_MS) return false;

  return probeDB();
};

const connectDB = async (retries = 10, delayMs = 5000) => {
  // Creating a pool does not connect, so the first real check is the probe
  // below. That is why the retry loop wraps the probe rather than the create.
  pool = mysql.createPool(poolOptions());

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');

      ready = true;
      lastProbeAt = Date.now();
      console.log('MySQL Doctor Appointment Database Connected...');
      return;
    } catch (error) {
      console.error(
        `MySQL Connection Error (attempt ${attempt}/${retries}): ${error.message}`,
      );
      if (attempt === retries) {
        console.error('Could not connect to MySQL after multiple attempts. Exiting.');
        process.exit(1);
      }
      await sleep(delayMs);
    }
  }
};

const getDB = () => {
  if (!pool) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return pool;
};

const isDBReady = () => ready;

export { connectDB, getDB, isDBReady, CONNECTION_LIMIT };
