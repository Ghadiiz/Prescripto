// Per-USER rate limiting for the assistant.
//
// express-rate-limit (middleware/rateLimiters.js) keys on IP, which is the
// wrong key here: two patients behind one clinic NAT would share a budget,
// and one patient on mobile data could reset theirs by changing network. The
// key has to be the authenticated user, so this is mounted AFTER auth — the
// key does not exist before it.
//
// In-memory on purpose. A restart clears it, which is harmless: the worst case
// is one user getting a few extra turns. 6.1 moves this to Redis, where it
// would be shared across instances and survive restarts.

const WINDOW_MS = 60 * 60 * 1000;
export const MAX_REQUESTS_PER_HOUR = 5;

// userId -> array of request timestamps within the window.
const hits = new Map();

export const RATE_LIMIT_MESSAGE =
  'You have reached the limit of ' +
  `${MAX_REQUESTS_PER_HOUR} assistant messages per hour. Please try again ` +
  'later — you can still browse doctors and book appointments as usual.';

// Exported for tests; also what 6.1 will replace with a Redis-backed reset.
export const resetRateLimits = () => hits.clear();

export const checkRateLimit = (userId, now = Date.now()) => {
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
    };
  }

  recent.push(now);
  hits.set(userId, recent);

  return {
    allowed: true,
    remaining: MAX_REQUESTS_PER_HOUR - recent.length,
    retryAfterSeconds: 0,
  };
};
