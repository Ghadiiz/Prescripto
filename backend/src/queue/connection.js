import Redis from 'ioredis';

// BullMQ's Redis connections — deliberately NOT 6.1's shared client.
//
// The two want opposite things, and both are right for their own job:
//
//   config/redis.js sets `maxRetriesPerRequest: 1` and
//   `enableOfflineQueue: false` so a command in the REQUEST PATH fails fast
//   and the store falls back to memory rather than making a patient wait.
//
//   BullMQ REQUIRES `maxRetriesPerRequest: null`. It holds long blocking
//   reads open and manages its own reconnection; a retry ceiling would abort
//   those and it refuses to start with one set.
//
// Sharing one client would mean either breaking the queue or undoing 6.1's
// fast-fail for every rate-limit check. So the queue gets its own connections
// to the same REDIS_URL.

// Seconds a worker blocks before re-issuing its read.
//
// The default is 5, which means roughly twelve commands a minute FOR DOING
// NOTHING. On a per-command plan like Upstash's that is a real bill for an
// idle queue, and this job has no latency requirement worth paying it for: a
// freed slot reaching a patient a minute later is the same news.
export const WORKER_DRAIN_DELAY_SECONDS = 60;

// How often a CONTINUING outage is allowed to say so.
//
// BullMQ requires `maxRetriesPerRequest: null`, so an unreachable Redis is
// retried forever by design — and every attempt emitted an error line.
// Measured against a dead port: 36 lines in 30 seconds, about 100,000 a day,
// for a single misconfigured URL.
//
// The retrying itself is correct and is NOT changed here. Only the logging is
// rate-limited.
export const ERROR_LOG_INTERVAL_MS = 60 * 1000;

// A logger that reports a state CHANGE loudly and a continuing state quietly.
//
// The shape matters more than the interval: the first failure and the recovery
// are the two moments someone needs to see, and repeating the same line
// between them tells nobody anything they did not already know. The suppressed
// count is carried into the periodic line so the volume is still visible.
export const createThrottledErrorLogger = (label, intervalMs = ERROR_LOG_INTERVAL_MS) => {
  let down = false;
  let lastLoggedAt = 0;
  let suppressed = 0;

  const onError = (error) => {
    const reason = error?.code ?? error?.message ?? 'unknown';
    const now = Date.now();

    if (!down) {
      down = true;
      lastLoggedAt = now;
      suppressed = 0;
      console.error(
        `${label} unavailable (${reason}). Retrying; further failures will be ` +
          `reported at most once every ${Math.round(intervalMs / 1000)}s until it recovers.`,
      );
      return;
    }

    suppressed += 1;

    if (now - lastLoggedAt >= intervalMs) {
      const seconds = Math.round((now - lastLoggedAt) / 1000);
      console.error(
        `${label} still unavailable (${reason}) — ${suppressed} further ` +
          `failures in the last ${seconds}s.`,
      );
      lastLoggedAt = now;
      suppressed = 0;
    }
  };

  // Called on a successful connect. Reporting recovery is what makes the
  // silence in between safe to interpret.
  const onReady = () => {
    if (!down) return;
    down = false;
    console.error(`${label} is available again.`);
    suppressed = 0;
  };

  return { onError, onReady };
};

const redisUrl = () => process.env.REDIS_URL || '';

// A NEW connection per caller, not a shared one.
//
// BullMQ's worker occupies its connection with a blocking read, so a queue
// sharing it would sit behind that block. The library warns about this; giving
// each component its own is the supported shape.
export const createQueueConnection = () => {
  const url = redisUrl();

  if (!url) return null;

  const connection = new Redis(url, {
    // Not a preference — BullMQ throws at startup without it.
    maxRetriesPerRequest: null,
  });

  // An EventEmitter with no 'error' listener throws, which would take the web
  // process down for a Redis blip the queue is designed to ride out.
  const log = createThrottledErrorLogger('Queue Redis');
  connection.on('error', log.onError);
  connection.on('ready', log.onReady);

  return connection;
};
