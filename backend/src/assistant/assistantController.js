import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { runConversation } from './agentLoop.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { emergencyCheck } from './guardrails/emergencyCheck.js';
import { scopeCheck } from './guardrails/scopeCheck.js';
import { loadHistory, saveHistory, appendTurn } from './conversationStore.js';
import { checkRateLimit, RATE_LIMIT_MESSAGE } from './rateLimit.js';
import { isAtCapacity, AtCapacityError } from './agentService.js';
import { toClientCard } from './clientCards.js';

// The endpoint that wires Phase 2 together.
//
// Bounded so an unbounded body cannot be pushed into the prompt.
const requestSchema = z
  .object({ message: z.string().min(1).max(2000) })
  .strict();

const FRIENDLY_ERROR =
  'Something went wrong while I was working on that. Please try again in a ' +
  'moment.';

// The free tier is a hard daily ceiling, so running out is a normal Tuesday,
// not an error. Say so plainly and point at what still works.
const AT_CAPACITY_MESSAGE =
  'I have reached my limit of requests for today, so I cannot look anything ' +
  'up right now. Please try again tomorrow — you can still browse doctors ' +
  'and book appointments as usual.';

// --- SSE plumbing -----------------------------------------------------------

const openStream = (res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Render sits behind a proxy that would otherwise buffer the whole
    // response and deliver it in one lump, defeating the point of streaming.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
};

const send = (res, event, data) => {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

// A single fixed answer that never involved the model: the guardrails, the
// rate limiter, the capacity cap. Opens a stream, says one thing, closes.
const sendFixedResponse = (res, text, reason, extra = {}) => {
  openStream(res);
  send(res, 'token', { delta: text });
  send(res, 'done', { stoppedReason: reason, ...extra });
  res.end();
};

export const chat = async (req, res) => {
  // ctx is built ONLY from the verified JWT. authMiddleware has already
  // checked the signature and rejected any role that is not `patient`, which
  // is why the literal below is safe — and why nothing from the body is read
  // into it. This object is the root of the identity chain every Phase 1 tool
  // depends on.
  const ctx = { userId: req.userId, role: 'patient' };

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'A message is required (1-2000 characters).',
    });
  }

  const userText = parsed.data.message;

  // Keyed on the authenticated user, never the IP.
  const limit = checkRateLimit(ctx.userId);
  if (!limit.allowed) {
    // The header is correct HTTP and stays for any non-browser client. It is
    // NOT how the panel learns the number: `cors()` sets no exposedHeaders, so
    // a browser reading Retry-After gets null. Widening CORS app-wide for one
    // panel is the larger change, so the value also travels in the SSE body,
    // where the rest of this turn's state already lives.
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));

    return sendFixedResponse(res, RATE_LIMIT_MESSAGE, 'rate_limited', {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  // Guardrails run BEFORE any provider call. Neither of these opens a
  // connection to the model.
  const emergency = emergencyCheck(userText);
  if (emergency.tripped) {
    return sendFixedResponse(res, emergency.response, 'emergency');
  }

  const scope = scopeCheck(userText);
  if (!scope.inScope) {
    return sendFixedResponse(res, scope.response, 'out_of_scope');
  }

  // LAST of the gates, deliberately: everything above answers without a
  // provider call, so running out of budget must not be able to suppress a
  // crisis response. Checked up front so the common case is one clean message
  // rather than a turn that dies partway through.
  if (isAtCapacity()) {
    return sendFixedResponse(res, AT_CAPACITY_MESSAGE, 'at_capacity');
  }

  const history = await loadHistory(ctx);

  // Minted here and threaded to runTool, so every audit row this turn writes
  // is attributable to one request.
  const sessionId = randomUUID();

  // A client that disconnects aborts the provider fetch rather than leaving it
  // running to completion for nobody.
  //
  // On the RESPONSE, not the request. Verified: for a POST whose body express
  // has already buffered, `req` emits 'close' the moment that body is read —
  // 39ms in, against a disconnect at 200ms. Listening there would mark every
  // single turn as abandoned. `res` emits 'close' on the real disconnect, and
  // `writableEnded` separates that from our own end().
  const controller = new AbortController();
  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true;
      controller.abort();
    }
  });

  openStream(res);

  try {
    const result = await runConversation({
      ctx,
      sessionId,
      system: buildSystemPrompt(),
      messages: [...history, { role: 'user', content: userText }],
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'text') {
          send(res, 'token', { delta: event.delta });
        } else if (event.type === 'status') {
          send(res, 'status', { tool: event.tool });
        } else if (event.type === 'result') {
          // The allowlist is the only thing that turns a tool result into
          // something a browser sees. It returns null for any tool without an
          // explicit projection, so nothing leaves here by default.
          const card = toClientCard(event.tool, event.result);
          if (card) send(res, 'card', card);
        }
      },
    });

    // An aborted turn is never saved. A truncated assistant sentence replayed
    // as history would be read by the model as something it actually finished
    // saying. Tool calls already made stay in the audit log — they happened.
    if (clientGone) return;

    await saveHistory(ctx, appendTurn(history, userText, result.text));

    send(res, 'done', {
      stoppedReason: result.stoppedReason,
      toolCallsMade: result.toolCallsMade,
    });
    res.end();
  } catch (error) {
    if (clientGone) return;

    // The cap can also trip mid-turn — a turn is several calls, and the 50th
    // can fall between them. The stream is already open and may already carry
    // text, so the capacity message is appended rather than sent alone. The
    // turn is NOT saved: an unfinished exchange is not an exchange, the same
    // rule the abort path follows.
    if (error instanceof AtCapacityError) {
      send(res, 'token', { delta: AT_CAPACITY_MESSAGE });
      send(res, 'done', { stoppedReason: 'at_capacity' });
      return res.end();
    }

    // Never leave the client hanging: one clean error event, then close.
    // The client is told the same thing whatever failed — a ProviderError's
    // message can carry a trimmed provider body, and that is for our logs, not
    // for a patient's screen.
    console.error('Assistant chat error:', error);

    send(res, 'error', { message: FRIENDLY_ERROR });
    res.end();
  }
};
