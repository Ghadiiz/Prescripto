import Redis from 'ioredis';

// The optional Redis connection.
//
// OPTIONAL is the whole design. With no REDIS_URL the assistant behaves
// exactly as it did before 6.1 — in-memory rate limits, confirmations and
// budget — so this increment can deploy to Render before any Redis exists.
// Setting one variable turns it on.
//
// That gives three states, and the stores must tell the second and third
// apart:
//
//   DISABLED  — no REDIS_URL. Normal operation on the memory path.
//   HEALTHY   — REDIS_URL set and reachable.
//   DEGRADED  — REDIS_URL set but the command failed.
//
// DISABLED and DEGRADED are NOT the same thing. An operator who never
// configured Redis has made a choice; a Redis that was configured and is now
// erroring is a fault, and confirmations.js refuses to authorise a write in
// that state. Collapsing the two would silently downgrade the one write tool's
// single-use guarantee the moment Redis hiccuped.

// Namespaced so a shared Redis (Render's Key Value instances often are) cannot
// collide with another app's keys.
export const KEY_PREFIX = 'prescripto:';

// Read at CALL time, never captured at import.
//
// A value read at import goes stale and is invisible to anything that
// configures the environment afterwards — which is exactly the bug a 2.2 test
// caught in agentService's baseDelayMs. It also means a test can enable and
// disable Redis between cases.
const redisUrl = () => process.env.REDIS_URL || '';

export const isRedisEnabled = () => Boolean(redisUrl());

let client = null;
let clientUrl = null;

export const getRedis = () => {
  const url = redisUrl();

  if (!url) return null;

  // Recreated when the URL changes, so "read at call time" holds for the
  // connection too and not merely for the flag.
  if (client && clientUrl !== url) {
    const stale = client;
    client = null;
    clientUrl = null;
    stale.disconnect();
  }

  if (client) return client;

  client = new Redis(url, {
    // Commands fail fast instead of queueing forever while the socket is
    // down. Without this a Redis outage turns every assistant request into a
    // hang, which is worse than the degraded behaviour the stores handle.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    // NOT lazyConnect. Paired with enableOfflineQueue: false it was a real
    // bug, caught by the Redis suite: a lazily-created client has no socket
    // yet, and with the offline queue disabled the FIRST command is rejected
    // outright. In production that meant the first assistant request after
    // boot silently took the memory path — and, worse, the first
    // spendConfirmation after boot failed CLOSED and refused a legitimate
    // write. Connecting eagerly plus awaitReady() below is what fixes it.
    retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 200, 1000)),
  });

  // ioredis emits 'error' on an unreachable server, and an EventEmitter with
  // no 'error' listener throws — which would take the process down for the
  // exact fault this module exists to survive.
  client.on('error', (error) => {
    console.error(`Redis unavailable (${error.code ?? error.message}).`);
  });

  clientUrl = url;

  return client;
};

// Closes and forgets the connection. Used by tests between cases, and by
// anything that wants a clean shutdown.
export const closeRedis = async () => {
  if (!client) return;

  const open = client;
  client = null;
  clientUrl = null;

  try {
    await open.quit();
  } catch {
    open.disconnect();
  }
};

// How long to wait for a socket before calling it degraded.
//
// Short on purpose: this sits in the request path, and the fallbacks are
// designed to be cheap. retryStrategy gives up after 3 attempts anyway, so a
// genuinely dead server reports back well inside this.
const READY_TIMEOUT_MS = 2000;

// Resolves once the client can actually take a command.
//
// Necessary because enableOfflineQueue is false: a command issued before the
// socket is ready is rejected rather than queued, so "connected yet?" has to
// be answered before the first command rather than discovered by it.
const awaitReady = (redis) =>
  new Promise((resolve, reject) => {
    if (redis.status === 'ready') return resolve();

    const done = (fn, arg) => {
      clearTimeout(timer);
      redis.off('ready', onReady);
      redis.off('error', onError);
      redis.off('end', onEnd);
      fn(arg);
    };

    const onReady = () => done(resolve);
    const onError = (error) => done(reject, error);
    const onEnd = () => done(reject, new Error('Redis connection ended'));
    const timer = setTimeout(
      () => done(reject, new Error(`Redis not ready within ${READY_TIMEOUT_MS}ms`)),
      READY_TIMEOUT_MS,
    );

    redis.once('ready', onReady);
    redis.once('error', onError);
    redis.once('end', onEnd);
  });

// Runs `work` against Redis and reports which of the three states applied.
//
// Every store goes through this, so "was Redis even configured?" is answered
// in one place rather than three, and the DEGRADED signal reaches the caller
// as data instead of an exception.
export const withRedis = async (work) => {
  const redis = getRedis();

  if (!redis) return { state: 'disabled', value: null };

  try {
    if (redis.status !== 'ready') await awaitReady(redis);
    return { state: 'healthy', value: await work(redis) };
  } catch (error) {
    console.error(`Redis command failed: ${error.message}`);
    return { state: 'degraded', value: null, error };
  }
};
