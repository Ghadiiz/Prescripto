import { createHash, randomUUID } from 'node:crypto';

import { KEY_PREFIX, isRedisEnabled, withRedis } from '../config/redis.js';

// Two-phase confirmation for the one tool that writes.
//
// A tool call is a single round-trip with no natural place to pause, so
// "requires explicit confirmation before writing" cannot be enforced by asking
// the model nicely. This makes it structural: the first call mints a token and
// writes nothing, and only a call carrying a matching token is allowed to
// write. A single call can never write, whatever the model decides to do.
//
// WHAT THIS DOES NOT GUARANTEE, stated plainly because it would be easy to
// assume otherwise: it does not prove a human was asked. The server cannot see
// the patient. It guarantees two phases; the system prompt and the agent loop
// are what turn the gap between them into a real question. Over MCP, where the
// host drives the model, that second half does not hold — which is why
// join_waitlist is not exposed there at all.
//
// 6.1 put this on Redis when REDIS_URL is set, so a restart mid-conversation
// no longer silently invalidates a patient's pending confirmation. With no
// REDIS_URL it is the same in-memory Map as before.

const TTL_MS = 10 * 60 * 1000;

// token -> { fingerprint, expiresAt }. The fallback, and the only path when
// Redis is not configured.
const pending = new Map();

// Binds a token to WHAT was confirmed as well as WHO confirmed it and WHERE.
//
// `userId` in here is what stops a token minted for one patient being spent by
// another — the difference between a confirmation and a capability anyone can
// pick up. The arguments are included so the doctor or the dates cannot be
// swapped between the preview a patient agreed to and the write that follows.
const fingerprintOf = (ctx, sessionId, args) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        ctx.userId,
        ctx.role,
        sessionId,
        args.doctor_id,
        args.date_from,
        args.date_to,
      ]),
    )
    .digest('hex');

const keyFor = (token) => `${KEY_PREFIX}confirm:${token}`;

const sweep = (now) => {
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(token);
  }
};

export const issueConfirmation = async (ctx, sessionId, args, now = Date.now()) => {
  const token = randomUUID();
  const fingerprint = fingerprintOf(ctx, sessionId, args);

  const { state } = await withRedis((redis) =>
    // NX so a UUID collision cannot overwrite a live confirmation, and PX so
    // Redis expires it rather than us needing a sweep.
    redis.set(keyFor(token), fingerprint, 'PX', TTL_MS, 'NX'),
  );

  if (state !== 'healthy') {
    // Issuing on the memory path while degraded is safe: spend() is the half
    // that gates the write, and it refuses outright while degraded. A token
    // minted here simply will not be spendable until Redis recovers.
    sweep(now);
    pending.set(token, { fingerprint, expiresAt: now + TTL_MS });
  }

  return token;
};

// Single use: a valid token is deleted as it is spent, so a replay finds
// nothing. Returns true only when the token exists, has not expired, and was
// issued for exactly this caller, session and arguments.
export const spendConfirmation = async (
  token,
  ctx,
  sessionId,
  args,
  now = Date.now(),
) => {
  if (!token) return false;

  const { state, value } = await withRedis((redis) =>
    // GETDEL, not GET-then-DEL. Single use has to be ATOMIC: with two commands
    // a replayed token racing the original could have both reads succeed
    // before either delete lands, and the one write tool would run twice for
    // one confirmation. Redis 6.2+.
    redis.getdel(keyFor(token)),
  );

  // FAIL CLOSED, and this is the one place in 6.1 that does.
  //
  // Redis is configured but faulting, so we cannot prove this token was
  // unspent. The rate limiter shrugs at that and falls back to memory because
  // its worst case is a few extra turns. Here the worst case is an unconfirmed
  // WRITE against a patient's record, so uncertainty has to mean no.
  //
  // Note this triggers only in the DEGRADED state. With Redis simply not
  // configured, `state` is 'disabled' and the memory path below is normal
  // operation, not a downgrade.
  if (state === 'degraded') {
    console.error(
      'Refusing to spend a confirmation while Redis is unavailable: ' +
        'single use cannot be guaranteed, so the write is declined.',
    );
    return false;
  }

  if (state === 'healthy') {
    if (!value) return false;
    return value === fingerprintOf(ctx, sessionId, args);
  }

  const entry = pending.get(token);
  if (!entry) return false;

  // Deleted whether or not it matches. A token presented with the wrong
  // arguments has been mishandled; letting it survive for another attempt
  // would be the wrong instinct.
  pending.delete(token);

  if (entry.expiresAt <= now) return false;

  return entry.fingerprint === fingerprintOf(ctx, sessionId, args);
};

// Tests only.
export const resetConfirmations = async () => {
  pending.clear();

  await withRedis(async (redis) => {
    const keys = await redis.keys(`${KEY_PREFIX}confirm:*`);
    if (keys.length) await redis.del(...keys);
  });
};

export const pendingCount = async () => {
  if (!isRedisEnabled()) return pending.size;

  const { state, value } = await withRedis(async (redis) =>
    (await redis.keys(`${KEY_PREFIX}confirm:*`)).length,
  );

  return state === 'healthy' ? value : pending.size;
};

export const CONFIRMATION_TTL_MS = TTL_MS;
