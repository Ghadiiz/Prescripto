import dotenv from 'dotenv';

dotenv.config();

// The ONLY file that knows which LLM provider is in use (CLAUDE.md).
//
// Everything downstream — 2.2's loop, 2.7's endpoint, 4.3's MCP server — talks
// to `generate()` and sees a normalised shape. No Gemini vocabulary
// (`candidates`, `parts`, `functionCall`, `role: 'model'`) crosses this
// boundary in either direction. Swapping providers should mean rewriting this
// file and nothing else.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// The free-tier quota is per MODEL per day (20 requests), so a spent model is
// not a spent account: rotating through these buys roughly 60 calls a day
// instead of 20. All three ids verified by live call rather than from
// ListModels, which advertises ids generateContent rejects with "no longer
// available to new users". Pinned exactly, not `-latest`, so behaviour cannot
// shift underneath us.
const MODEL_ROTATION = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
];

// GEMINI_MODELS (comma-separated) replaces the rotation outright; set it to a
// single id to pin one model, which is how 2.9's eval targets a model.
//
// GEMINI_MODEL keeps its name but now means "start HERE", falling through to
// the rest. It used to pin. An env file must not be able to switch off the
// graceful degradation this whole increment exists to provide.
const modelRotation = () => {
  const listed = (process.env.GEMINI_MODELS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (listed.length) return listed;

  const preferred = process.env.GEMINI_MODEL;

  return preferred
    ? [preferred, ...MODEL_ROTATION.filter((id) => id !== preferred)]
    : MODEL_ROTATION;
};

const MAX_ATTEMPTS = 3;
// Read at call time, like the API key: a value captured at import can go stale
// and is invisible to anything that configures the environment later.
const baseDelayMs = () => Number(process.env.GEMINI_RETRY_BASE_MS ?? 500);
// A provider-supplied Retry-After must not be able to hang a request.
const MAX_RETRY_AFTER_MS = 10_000;

export class ProviderError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
  }
}

// The key must never reach a log, a thrown message or an error object. Provider
// error bodies sometimes echo the request, so scrub defensively.
const redact = (text, key) => {
  if (!text) return '';
  const scrubbed = key ? String(text).split(key).join('[REDACTED]') : String(text);
  return scrubbed.slice(0, 300);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Full jitter: random across the whole window rather than a small wobble
// around it. Prevents retries synchronising, which matters once 6.1 puts this
// behind a shared rate limiter.
export const computeBackoffMs = (attempt, retryAfterSeconds = null) => {
  if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds)) {
    return Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
  }

  const window = baseDelayMs() * 2 ** (attempt - 1);
  return Math.random() * window;
};

// 429 and 5xx are worth another go. 400/401/403 are a bug or a bad key, and
// retrying only delays the diagnosis — the same rule 1.7 applies to audit
// writes.
const isRetryableStatus = (status) => status === 429 || status >= 500;

// --- daily budget -----------------------------------------------------------
//
// Two mechanisms, and they are deliberately NOT equally important.
//
// Rotation is the OPTIMISATION: it depends on recognising Google's
// daily-quota 429, which is their format to change.
//
// The soft-cap is the GUARANTEE: it counts calls WE made, so the friendly
// capacity message stays reachable even if that format moves. When in doubt
// about the design below, that is the distinction it is protecting.
//
// In memory on purpose. A restart clears it, which only allows a few extra
// calls before the cap re-engages — harmless at demo scale. 6.1 moves this to
// Redis alongside the per-user limiter, shared across instances.

const DEFAULT_DAILY_CALL_CAP = 50;

// Read at call time, like the key and the backoff base: a value captured at
// import goes stale and is invisible to anything configuring the environment
// later. A 2.2 test caught exactly that bug in baseDelayMs.
const dailyCallCap = () =>
  Number(process.env.GEMINI_DAILY_CALL_CAP ?? DEFAULT_DAILY_CALL_CAP);

let budget = { day: null, calls: 0, exhausted: new Set() };

const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

// Date-keyed rather than timer-driven. No setInterval to keep the process
// alive or remember to unref, and "what happens at midnight" is testable by
// passing `now` instead of waiting for it.
const rollover = (now) => {
  const day = utcDay(now);
  if (budget.day !== day) budget = { day, calls: 0, exhausted: new Set() };
  return budget;
};

// The neutral "stop asking" signal. A distinct class so callers can use
// instanceof rather than matching on a message, and named for the situation
// rather than the provider — the endpoint never learns what a model is.
export class AtCapacityError extends Error {
  constructor(message = 'The assistant is at capacity for today.') {
    super(message);
    this.name = 'AtCapacityError';
  }
}

// Exported for tests; also what 6.1 replaces with a Redis-backed reset.
export const resetBudget = () => {
  budget = { day: null, calls: 0, exhausted: new Set() };
};

export const getBudget = (now = Date.now()) => {
  const current = rollover(now);

  return {
    day: current.day,
    callsToday: current.calls,
    remaining: Math.max(0, dailyCallCap() - current.calls),
    exhaustedModels: [...current.exhausted],
  };
};

// Checked by the endpoint BEFORE a turn starts, so the common case is one
// clean message rather than a turn that dies partway through.
export const isAtCapacity = (now = Date.now()) => {
  const current = rollover(now);

  return (
    current.calls >= dailyCallCap() ||
    modelRotation().every((id) => current.exhausted.has(id))
  );
};

// The next model worth trying. Sticky: a model already known spent today is
// skipped rather than re-probed, so the next turn does not pay a call to
// rediscover the same 429.
const pickModel = (now = Date.now()) => {
  const current = rollover(now);

  if (current.calls >= dailyCallCap()) throw new AtCapacityError();

  const model = modelRotation().find((id) => !current.exhausted.has(id));
  if (!model) throw new AtCapacityError();

  return model;
};

// Counts ACTUAL provider calls, including retries — one user turn is several.
// A retry is a real request against Google's quota, so it counts.
const noteCall = (now = Date.now()) => {
  rollover(now).calls += 1;
};

const markExhausted = (model, now = Date.now()) => {
  rollover(now).exhausted.add(model);
};

// Google returns 429 for BOTH the per-minute rate limit and the per-day quota,
// and the two need opposite handling: per-minute clears in seconds and is
// worth retrying, per-day will not clear for hours and retrying only adds lag
// to a request that cannot succeed.
//
// Tested against the RAW body, never the redacted one — redact() truncates to
// 300 characters and the quota id can sit past that. The raw text stays in a
// local and reaches no log and no thrown message.
//
// A substring test rather than a path lookup, so it holds wherever in the body
// the id sits. The id GenerateRequestsPerDayPerProjectPerModel-FreeTier was
// recorded from a real 429 during 2.2. If Google renames it, rotation stops
// firing and behaviour falls back to exactly what shipped before this
// increment — while the soft-cap, which parses nothing, still ends the day
// gracefully.
const isDailyQuotaError = (rawBody) => /PerDay/i.test(rawBody ?? '');

// --- provider mapping (nothing below this line escapes the module) ---

const toGeminiContents = (messages) =>
  messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: message.name,
              // Pairs the result with the call it answers.
              ...(message.providerRef?.id ? { id: message.providerRef.id } : {}),
              response: { result: message.content },
            },
          },
        ],
      };
    }

    // An assistant turn that CALLED tools. Without this branch the tool calls
    // are silently dropped and the next request shows the model results for
    // calls it cannot see itself making — the history stops being faithful.
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'model',
        parts: [
          // Any text the model produced alongside the calls comes first.
          ...(message.content ? [{ text: String(message.content) }] : []),
          ...message.toolCalls.map((call) => ({
            functionCall: {
              name: call.name,
              args: call.args ?? {},
              ...(call.providerRef?.id ? { id: call.providerRef.id } : {}),
            },
            // Echoed back verbatim; the API rejects the part without it.
            ...(call.providerRef?.thoughtSignature
              ? { thoughtSignature: call.providerRef.thoughtSignature }
              : {}),
          })),
        ],
      };
    }

    return {
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(message.content ?? '') }],
    };
  });

// `tools` arrive as provider-neutral { name, description, parameters }, where
// parameters is plain JSON Schema. 2.2 produces those from the zod schemas.
const toGeminiTools = (tools) =>
  tools?.length
    ? [
        {
          functionDeclarations: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ]
    : undefined;

const FINISH_REASONS = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'safety',
  RECITATION: 'safety',
  PROHIBITED_CONTENT: 'safety',
};

const fromGeminiResponse = (body) => {
  const candidate = body?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  const text = parts
    .filter((part) => typeof part.text === 'string')
    .map((part) => part.text)
    .join('');

  const toolCalls = parts
    .filter((part) => part.functionCall)
    .map((part) => {
      // Opaque provider state that must be echoed back verbatim when this turn
      // is replayed in history. Gemini 3.x rejects a functionCall part sent
      // back without its thoughtSignature. Callers pass `providerRef` through
      // untouched and must never interpret it — that is what keeps the loop
      // provider-agnostic while still being faithful.
      const providerRef = {
        ...(part.functionCall.id ? { id: part.functionCall.id } : {}),
        ...(part.thoughtSignature
          ? { thoughtSignature: part.thoughtSignature }
          : {}),
      };

      return {
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
        ...(Object.keys(providerRef).length ? { providerRef } : {}),
      };
    });

  const usage = body?.usageMetadata
    ? {
        inputTokens: body.usageMetadata.promptTokenCount ?? null,
        outputTokens: body.usageMetadata.candidatesTokenCount ?? null,
      }
    : null;

  return {
    text,
    toolCalls,
    finishReason: toolCalls.length
      ? 'tool_calls'
      : (FINISH_REASONS[candidate?.finishReason] ?? 'stop'),
    usage,
  };
};

// Shared by generate() and generateStream() so the two cannot drift in how a
// request is built or a key is required.
const buildRequest = ({ system, messages = [], tools = [] }) => {
  // Read at call time, not import time, so the app still boots without a key.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ProviderError('GEMINI_API_KEY is not set', { retryable: false });
  }

  return {
    apiKey,
    payload: {
      contents: toGeminiContents(messages),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(toGeminiTools(tools) ? { tools: toGeminiTools(tools) } : {}),
    },
    // Header rather than a query parameter: keys in URLs end up in logs and
    // proxy traces.
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
  };
};

export const generate = async ({
  system,
  messages = [],
  tools = [],
  signal,
} = {}) => {
  const { apiKey, payload, headers } = buildRequest({ system, messages, tools });

  let lastError;

  // Two separate budgets, deliberately. `attempt` counts genuine RETRIES of
  // the same model and is capped at MAX_ATTEMPTS. Rotating after a daily-quota
  // 429 is not a retry — it is a different model, with its own quota — so it
  // does not consume one. Rotation is bounded regardless: each daily 429
  // removes a model from the pool, and an empty pool throws AtCapacityError.
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS) {
    // Throws AtCapacityError when the cap is reached or every model is spent,
    // before spending a request to find out.
    const model = pickModel();
    let response;

    noteCall();

    try {
      response = await fetch(`${API_BASE}/models/${model}:generateContent`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      // An aborted request is the caller's decision, not a failure to retry.
      if (error.name === 'AbortError') throw error;

      attempt += 1;
      lastError = new ProviderError(
        `Provider request failed: ${redact(error.message, apiKey)}`,
        { retryable: true },
      );

      if (attempt >= MAX_ATTEMPTS) throw lastError;
      await sleep(computeBackoffMs(attempt));
      continue;
    }

    if (response.ok) {
      return fromGeminiResponse(await response.json());
    }

    const rawBody = await response.text().catch(() => '');

    // This model is done for the day. Switch and do NOT sleep — there is
    // nothing to wait for, and the lag would be pure loss.
    if (response.status === 429 && isDailyQuotaError(rawBody)) {
      markExhausted(model);
      continue;
    }

    attempt += 1;

    const retryable = isRetryableStatus(response.status);

    lastError = new ProviderError(
      `Provider returned ${response.status}: ${redact(rawBody, apiKey)}`,
      { status: response.status, retryable },
    );

    if (!retryable || attempt >= MAX_ATTEMPTS) throw lastError;

    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(
      computeBackoffMs(attempt, Number.isFinite(retryAfter) ? retryAfter : null),
    );
  }

  throw lastError;
};

// Streaming counterpart to generate(). Yields PROVIDER-NEUTRAL events:
//
//   { type: 'text', delta }
//   { type: 'done', text, toolCalls, finishReason, usage }
//
// Nothing Gemini-shaped escapes: chunks are parsed here, parts accumulated,
// and the same normaliser produces the same shape generate() returns. Verified
// live that a streamed tool round arrives as one chunk carrying functionCall
// with args, id AND thoughtSignature, so streaming loses nothing.
export async function* generateStream({
  system,
  messages = [],
  tools = [],
  signal,
} = {}) {
  const { apiKey, payload, headers } = buildRequest({ system, messages, tools });

  // Retrying and rotating are safe HERE and only here: a 429 arrives with the
  // response headers, before a single byte has reached the consumer, so
  // re-issuing is not replaying a partially-consumed stream. Once yielding
  // begins, nothing below is retried — that stream genuinely cannot be
  // replayed, because the caller has already seen part of it.
  let response;
  let attempt = 0;

  while (true) {
    const model = pickModel();

    noteCall();

    try {
      response = await fetch(
        `${API_BASE}/models/${model}:streamGenerateContent?alt=sse`,
        { method: 'POST', headers, body: JSON.stringify(payload), signal },
      );
    } catch (error) {
      if (error.name === 'AbortError') throw error;

      attempt += 1;
      const failure = new ProviderError(
        `Provider request failed: ${redact(error.message, apiKey)}`,
        { retryable: true },
      );

      if (attempt >= MAX_ATTEMPTS) throw failure;
      await sleep(computeBackoffMs(attempt));
      continue;
    }

    if (response.ok) break;

    const rawBody = await response.text().catch(() => '');

    if (response.status === 429 && isDailyQuotaError(rawBody)) {
      markExhausted(model);
      continue;
    }

    attempt += 1;

    const failure = new ProviderError(
      `Provider returned ${response.status}: ${redact(rawBody, apiKey)}`,
      {
        status: response.status,
        retryable: isRetryableStatus(response.status),
      },
    );

    if (!failure.retryable || attempt >= MAX_ATTEMPTS) throw failure;

    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(
      computeBackoffMs(attempt, Number.isFinite(retryAfter) ? retryAfter : null),
    );
  }

  // Accumulated across chunks so the final `done` event carries the same
  // normalised shape as generate().
  const parts = [];
  let usage = null;
  let finishReason = null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are newline-delimited; the last fragment may be partial.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        let chunk;
        try {
          chunk = JSON.parse(line.slice(6));
        } catch {
          // A malformed frame is not worth killing a live stream over.
          continue;
        }

        const candidate = chunk.candidates?.[0];
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
        if (candidate?.finishReason) finishReason = candidate.finishReason;

        for (const part of candidate?.content?.parts ?? []) {
          parts.push(part);
          if (typeof part.text === 'string' && part.text.length > 0) {
            yield { type: 'text', delta: part.text };
          }
        }
      }
    }
  } finally {
    // Releases the socket whether the stream ended, threw, or the consumer
    // stopped iterating early.
    reader.cancel().catch(() => {});
  }

  yield {
    type: 'done',
    ...fromGeminiResponse({
      candidates: [{ content: { parts }, finishReason }],
      usageMetadata: usage,
    }),
  };
}
