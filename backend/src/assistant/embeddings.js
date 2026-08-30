import { computeBackoffMs, ProviderError } from './agentService.js';

// The embedding client — the SECOND file that knows which provider is in use.
//
// CLAUDE.md's rule was "only agentService.js may know the provider". 8.2
// amended it to name this file too, deliberately and in writing, rather than
// quietly becoming a second provider-aware module that contradicts a rule
// nobody remembered to update. What the rule protects is that swapping
// providers touches a known, small set of files; that set is now two, and both
// are here in `assistant/`.
//
// Embedding is a different capability from the chat loop — different endpoint,
// different request and response shape, no tools, no streaming, no budget —
// so it lives beside agentService rather than inside it. What it does NOT
// duplicate is the retry policy: `computeBackoffMs` and `ProviderError` are
// imported, so there is one implementation of "how we back off a 429".

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const EMBEDDING_MODEL = 'gemini-embedding-001';

// 768 rather than the model's default 3072. The corpus is a dozen short,
// topically distinct passages — booking, waitlist, privacy are not subtle
// distinctions — and 768 is a quarter of the bytes to read and parse on every
// query. `platform_docs.embedding_dim` records it, so changing it later is a
// re-ingest rather than a migration.
export const EMBEDDING_DIM = 768;

// TASK TYPES ARE ASYMMETRIC ON PURPOSE. DO NOT "FIX" THIS.
//
// A document and a query about the SAME text embed differently: measured at
// cosine 0.827 between the two, not 1.0. That is the model doing what it is
// designed to do — a passage is embedded as something to be found, a question
// as something looking. Making both sides use one task type would look tidier
// and would quietly make retrieval worse.
const DOCUMENT_TASK = 'RETRIEVAL_DOCUMENT';
const QUERY_TASK = 'RETRIEVAL_QUERY';

const MAX_ATTEMPTS = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same rule agentService applies: 429 and 5xx are worth another go, 4xx
// otherwise is a bug or a bad key and retrying only delays the diagnosis.
const isRetryableStatus = (status) => status === 429 || status >= 500;

const redact = (text, key) => {
  if (!text) return '';
  const scrubbed = key ? String(text).split(key).join('[REDACTED]') : String(text);
  return scrubbed.slice(0, 300);
};

// THE TRAP THIS FUNCTION EXISTS FOR.
//
// The model's 3072-dimension output is already unit-length (measured: exactly
// 1.000000). A TRUNCATED output is NOT — the 768 vector measured 0.591345.
//
// Cosine similarity divides by both magnitudes, so un-normalised vectors would
// still rank correctly. The danger is what comes next: a dot product is the
// obvious shortcut once vectors are "supposed to be" unit-length, and on these
// it would be silently wrong — smaller vectors scoring lower for no reason
// about their meaning. Normalising once here means every vector in the table
// is unit-length by construction and no later caller can get this wrong.
const normalise = (vector) => {
  const magnitude = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));

  // A zero vector cannot be normalised and cannot be meaningfully compared;
  // returning it unchanged keeps the failure visible rather than producing
  // NaNs that spread.
  if (!magnitude || !Number.isFinite(magnitude)) return vector;

  return vector.map((x) => x / magnitude);
};

const requestFor = (text, taskType) => ({
  model: `models/${EMBEDDING_MODEL}`,
  content: { parts: [{ text }] },
  taskType,
  outputDimensionality: EMBEDDING_DIM,
});

const callProvider = async (path, body) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new ProviderError('GEMINI_API_KEY is not set', { retryable: false });
  }

  let attempt = 0;
  let lastError = null;

  while (attempt < MAX_ATTEMPTS) {
    let response;

    try {
      response = await fetch(`${API_BASE}/models/${EMBEDDING_MODEL}:${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // A transport failure is worth another go, unlike a 400.
      lastError = new ProviderError(
        `Embedding request failed: ${redact(error.message, apiKey)}`,
        { retryable: true },
      );
      attempt += 1;
      if (attempt >= MAX_ATTEMPTS) throw lastError;
      await sleep(computeBackoffMs(attempt));
      continue;
    }

    if (response.ok) return response.json();

    const rawBody = await response.text();
    const error = new ProviderError(
      `Embedding provider returned ${response.status}: ${redact(rawBody, apiKey)}`,
      { status: response.status, retryable: isRetryableStatus(response.status) },
    );

    if (!error.retryable) throw error;

    lastError = error;
    attempt += 1;
    if (attempt >= MAX_ATTEMPTS) throw lastError;

    const retryAfter = Number(response.headers?.get?.('retry-after'));
    await sleep(computeBackoffMs(attempt, Number.isFinite(retryAfter) ? retryAfter : null));
  }

  throw lastError;
};

// Ingestion: many passages, one call. `batchEmbedContents` returns them in
// request order, which is what lets the caller zip the results back onto its
// documents without an id round-trip.
export const embedDocuments = async (texts) => {
  if (!texts.length) return [];

  const payload = await callProvider('batchEmbedContents', {
    requests: texts.map((text) => requestFor(text, DOCUMENT_TASK)),
  });

  const vectors = payload?.embeddings ?? [];

  if (vectors.length !== texts.length) {
    throw new ProviderError(
      `Asked for ${texts.length} embeddings and got ${vectors.length}`,
      { retryable: false },
    );
  }

  return vectors.map((entry) => normalise(entry.values ?? []));
};

// Retrieval (8.3): one question, one vector, the QUERY task type.
export const embedQuery = async (text) => {
  const payload = await callProvider('embedContent', requestFor(text, QUERY_TASK));

  return normalise(payload?.embedding?.values ?? []);
};
