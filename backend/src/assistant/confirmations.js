import { createHash, randomUUID } from 'node:crypto';

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
// In memory on purpose, like rateLimit.js. A restart drops pending
// confirmations, which costs a patient one extra "yes" and nothing more. 6.1
// moves both to Redis.

const TTL_MS = 10 * 60 * 1000;

// token -> { fingerprint, expiresAt }
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

const sweep = (now) => {
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(token);
  }
};

export const issueConfirmation = (ctx, sessionId, args, now = Date.now()) => {
  sweep(now);

  const token = randomUUID();
  pending.set(token, {
    fingerprint: fingerprintOf(ctx, sessionId, args),
    expiresAt: now + TTL_MS,
  });

  return token;
};

// Single use: a valid token is deleted as it is spent, so a replay finds
// nothing. Returns true only when the token exists, has not expired, and was
// issued for exactly this caller, session and arguments.
export const spendConfirmation = (token, ctx, sessionId, args, now = Date.now()) => {
  if (!token) return false;

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
export const resetConfirmations = () => pending.clear();
export const pendingCount = () => pending.size;
export const CONFIRMATION_TTL_MS = TTL_MS;
