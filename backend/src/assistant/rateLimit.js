import { randomUUID } from 'node:crypto';

import { KEY_PREFIX, withRedis } from '../config/redis.js';

// Per-USER rate limiting for the assistant.
//
// express-rate-limit (middleware/rateLimiters.js) keys on IP, which is the
// wrong key here: two patients behind one clinic NAT would share a budget,
// and one patient on mobile data could reset theirs by changing network. The
// key has to be the authenticated user, so this is mounted AFTER auth — the
// key does not exist before it.
//
// 6.1 put this on Redis when REDIS_URL is set. With no REDIS_URL it is the
// same in-memory Map it always was, and a restart still clears it — harmless,
// as before: the worst case is one user getting a few extra turns.
//
// A Redis FAULT falls back to memory for the same reason. This file's whole
// cost of being wrong is a handful of extra assistant turns, so trading that
// for an outage would be a bad bargain. confirmations.js makes the opposite
// call, because what it protects is a write.

const WINDOW_MS = 60 * 60 * 1000;
export const MAX_REQUESTS_PER_HOUR = 5;

// userId -> array of request timestamps within the window. The fallback path,
// and the only path when Redis is not configured.
const hits = new Map();

export const RATE_LIMIT_MESSAGE =
  'You have reached the limit of ' +
  `${MAX_REQUESTS_PER_HOUR} assistant messages per hour. Please try again ` +
  'later — you can still browse doctors and book appointments as usual.';

const keyFor = (userId) => `${KEY_PREFIX}ratelimit:${userId}`;

// One round trip, evaluated atomically by Redis.
//
// The obvious alternative — ZCARD, decide, then ZADD — has a race the
// in-memory version never had: two requests arriving together both read a
// count below the limit and both proceed. Node's single thread hid that
// problem; Redis does not, so the check and the insert have to happen in one
// place. This is the same instinct as making double-booking a database
// guarantee rather than an application one.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count >= max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, 0, tonumber(oldest[2])}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)

return {1, max - count - 1, 0}
`;

const checkInMemory = (userId, now) => {
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(userId) ?? []).filter(
    (timestamp) => timestamp > cutoff,
  );

  if (recent.length >= MAX_REQUESTS_PER_HOUR) {
    hits.set(userId, recent);

    return {
      allowed: false,
      remaining: 0,
      // Seconds until the oldest hit leaves the window.
      retryAfterSeconds: Math.ceil((recent[0] + WINDOW_MS - now) / 1000),
      store: 'memory',
    };
  }

  recent.push(now);
  hits.set(userId, recent);

  return {
    allowed: true,
    remaining: MAX_REQUESTS_PER_HOUR - recent.length,
    retryAfterSeconds: 0,
    store: 'memory',
  };
};

export const checkRateLimit = async (userId, now = Date.now()) => {
  const { state, value } = await withRedis((redis) =>
    redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      keyFor(userId),
      now,
      WINDOW_MS,
      MAX_REQUESTS_PER_HOUR,
      // Unique member per hit: two requests in the same millisecond would
      // otherwise collapse into one sorted-set entry and quietly refund a turn.
      `${now}-${randomUUID()}`,
    ),
  );

  // Not configured, or configured and faulting — either way the memory path is
  // correct here. See the header: this limiter's failure cost is bounded.
  if (state !== 'healthy') return checkInMemory(userId, now);

  const [allowed, remaining, oldest] = value;

  return {
    allowed: allowed === 1,
    remaining: Number(remaining),
    retryAfterSeconds:
      allowed === 1 ? 0 : Math.max(1, Math.ceil((Number(oldest) + WINDOW_MS - now) / 1000)),
    store: 'redis',
  };
};

// Exported for tests. Clears BOTH stores, so a suite that switches REDIS_URL
// between cases cannot leak counts from one into the other.
export const resetRateLimits = async () => {
  hits.clear();

  await withRedis(async (redis) => {
    const keys = await redis.keys(`${KEY_PREFIX}ratelimit:*`);
    if (keys.length) await redis.del(...keys);
  });
};
