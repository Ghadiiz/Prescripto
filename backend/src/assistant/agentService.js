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

// Verified against the live API for this account rather than assumed:
// ListModels still advertises gemini-2.5-flash, but generateContent rejects it
// with "no longer available to new users" and points here instead. Pinned
// rather than `gemini-flash-latest` so behaviour cannot shift underneath us;
// override with GEMINI_MODEL.
const DEFAULT_MODEL = 'gemini-3.6-flash';

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
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
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
  const { apiKey, model, payload } = buildRequest({ system, messages, tools });

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;

    try {
      response = await fetch(`${API_BASE}/models/${model}:generateContent`, {
        method: 'POST',
        // Header rather than a query parameter: keys in URLs end up in logs
        // and proxy traces.
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      // An aborted request is the caller's decision, not a failure to retry.
      if (error.name === 'AbortError') throw error;

      lastError = new ProviderError(
        `Provider request failed: ${redact(error.message, apiKey)}`,
        { retryable: true },
      );

      if (attempt === MAX_ATTEMPTS) throw lastError;
      await sleep(computeBackoffMs(attempt));
      continue;
    }

    if (response.ok) {
      return fromGeminiResponse(await response.json());
    }

    const body = redact(await response.text().catch(() => ''), apiKey);
    const retryable = isRetryableStatus(response.status);

    lastError = new ProviderError(
      `Provider returned ${response.status}: ${body}`,
      { status: response.status, retryable },
    );

    if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;

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
  const { model, payload, headers } = buildRequest({ system, messages, tools });

  // No retry loop here: a stream that fails mid-body cannot be transparently
  // replayed, because the caller has already seen some of it. Connection
  // failures before the first byte still surface as a ProviderError, and the
  // endpoint turns that into a clean SSE error event.
  let response;
  try {
    response = await fetch(
      `${API_BASE}/models/${model}:streamGenerateContent?alt=sse`,
      { method: 'POST', headers, body: JSON.stringify(payload), signal },
    );
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ProviderError(
      `Provider request failed: ${redact(error.message, headers['x-goog-api-key'])}`,
      { retryable: true },
    );
  }

  if (!response.ok) {
    const body = redact(
      await response.text().catch(() => ''),
      headers['x-goog-api-key'],
    );
    throw new ProviderError(`Provider returned ${response.status}: ${body}`, {
      status: response.status,
      retryable: isRetryableStatus(response.status),
    });
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
