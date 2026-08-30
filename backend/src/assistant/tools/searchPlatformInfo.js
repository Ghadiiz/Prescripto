import { z } from 'zod';

import { listPlatformDocs } from '../models/platformDocQueries.js';
import { embedQuery, EMBEDDING_MODEL, EMBEDDING_DIM } from '../embeddings.js';
import { sanitizePassage, sanitizeShortText } from '../guardrails/sanitize.js';

// THE OTHER KIND OF RETRIEVAL, and the point of Phase 8.
//
// Every other tool in this directory answers from ROWS: a doctor's fee, a
// speciality list, which half-hours are free. Those questions have one correct
// answer and a query that computes it.
//
// This one answers from PROSE — how booking works, how the waitlist works, what
// this assistant can and cannot do — where there is no SQL answer to compute
// and the useful reply is an explanation someone wrote. The split is by the
// SHAPE OF THE DATA, not by topic, and it is why per-doctor facts must never
// be added to `platform_docs`: burying computable rows in a vector index makes
// an exact question into a similarity search and goes stale the moment a fee
// changes.

// How similar a passage must be before it counts as an answer at all.
//
// MEASURED, on this corpus, in 8.2 — twelve passages against eight real
// questions and four with no answer here:
//
//   on-topic  top scores   0.668 - 0.794
//   off-topic top scores   0.524 - 0.593   ("what is the capital of France?",
//                                           "do I have diabetes?", weather,
//                                           and a prompt-injection attempt)
//
// 0.62 sits in that gap: 0.048 of headroom below the weakest real answer, 0.027
// above the strongest false one. The asymmetry is deliberate — refusing a
// question we CAN answer is worse than returning a weak passage the model can
// judge for itself, and it sees the score.
//
// THIS NUMBER IS TUNED, NOT DERIVED. It describes this corpus, not the model.
// Re-run 8.2's probe queries and re-check it whenever passages are added,
// rewritten or removed.
const MIN_SIMILARITY = 0.62;

// The top FEW, not the winner. Measured first-to-second gaps were as little as
// 0.023, which is far too thin to present one passage as uniquely right — and
// two adjacent passages often belong in the same answer anyway.
const MAX_RESULTS = 3;

const schema = z
  .object({
    query: z.string().min(3).max(400),
  })
  .strict();

// A DOT PRODUCT, and it is the cosine — but only because both sides are unit
// vectors. 8.2 normalises at write time (stored vectors measure exactly
// 1.000000000) and `embedQuery` normalises what it returns.
//
// If either side ever stops normalising, this silently starts ranking by
// magnitude as much as by meaning. It will not throw and it will not look
// wrong; it will just quietly return worse passages. That is the whole reason
// normalisation lives at write time rather than here.
const similarity = (a, b) => {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i] * b[i];
  return total;
};

const toVector = (value) => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed : null;
};

// Pure, so the ranking can be tested with hand-built vectors instead of the
// network.
export const rankPassages = (queryVector, rows) => {
  const comparable = [];
  let incomparable = 0;

  for (const row of rows) {
    // The guard 8.1's columns exist for. Vectors from a different model, or of
    // a different length, are not comparable with this query — the dot product
    // would still produce a NUMBER, which is exactly the failure mode worth
    // preventing. Nothing throws; the rankings would just be noise.
    if (row.embedding_model !== EMBEDDING_MODEL) {
      incomparable += 1;
      continue;
    }

    const vector = toVector(row.embedding);

    if (!vector || vector.length !== queryVector.length) {
      incomparable += 1;
      continue;
    }

    comparable.push({ row, score: similarity(queryVector, vector) });
  }

  const matches = comparable
    .filter(({ score }) => score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);

  return { matches, incomparable, comparableCount: comparable.length };
};

// Pure, and exported for the same reason `rankPassages` is: the sanitising in
// here is a rule 5 guarantee, and a guarantee that can only be exercised
// through a network call is a guarantee that gets tested once and then not
// again. Building the result is separable from fetching one, so it is separate.
export const toResult = ({ row, score }) => ({
  slug: row.slug,
  title: sanitizeShortText(row.title),
  // Rule 5. Not because the author is untrusted — this corpus is ours and
  // lives in the repo — but because a retrieved passage is DATA whatever its
  // provenance, and text inside one that reads like an instruction is text
  // that happens to say those words.
  passage: sanitizePassage(row.content),
  source: row.source ? sanitizeShortText(row.source) : null,
  // The model sees the score so it can judge for itself how well the passage
  // fits, rather than treating the top result as certainly right.
  score: Number(score.toFixed(4)),
  _unverified: ['title', 'passage', 'source'],
});

// THE RETRIEVAL HALF, split from the embedding half.
//
// Everything that can leak — the database read, the ranking, the sanitising,
// the shape of a result — is on this side. The only thing on the other side is
// turning a question into a vector.
//
// Separating them lets the guardrail suite drive a REAL retrieval from a
// pre-computed real query vector, with no provider call. That matters beyond
// convenience: CI deliberately holds no real API key (6.4), so a guarantee
// that could only be checked with one would either fail in CI or have to be
// skipped there — and a guarantee skipped by default is not a guarantee.
//
// The vector arrives LAZILY, as a function rather than a value. That keeps the
// empty-corpus check ahead of the embedding call, so a misconfigured database
// costs nothing per query instead of burning a request on every one — while
// still letting a caller supply a vector it already has. Passing the value
// directly would have forced a choice between the two; this way there is only
// one copy of the check and no wasted call.
const retrieve = async (getQueryVector) => {
  const rows = await listPlatformDocs();

  if (!rows.length) {
    console.error(
      'search_platform_info: platform_docs is EMPTY. Run `npm run ' +
        'ingest:docs` against this database — retrieval answers nothing ' +
        'until the corpus is ingested.',
    );
    return [];
  }

  const { matches, incomparable, comparableCount } = rankPassages(
    await getQueryVector(),
    rows,
  );

  // An operational fault, not the patient's problem. The model gets nothing
  // and says it does not know — which is honest, because we genuinely cannot
  // retrieve — while the log says what a human needs to do about it.
  if (comparableCount === 0 && incomparable > 0) {
    console.error(
      `search_platform_info: all ${incomparable} passage(s) were embedded ` +
        `with a different model or dimension than ${EMBEDDING_MODEL}/` +
        `${EMBEDDING_DIM}. They cannot be compared with this query. ` +
        'Re-run `npm run ingest:docs` to re-embed the corpus.',
    );
  }

  // An ARRAY on purpose: runTool's countResults gives an array its length, so
  // `assistant_audit_log` records how many passages actually answered. A 0 in
  // that column is then a real signal that the corpus does not cover something
  // patients are asking about. An object would log 1 either way.
  return matches.map(toResult);
};

// Retrieval driven by a vector the caller already has. This is the seam the
// guardrail suite uses; the corpus read, ranking, sanitising and result shape
// are all the production ones.
export const retrieveWith = (queryVector) => retrieve(() => queryVector);

export default {
  name: 'search_platform_info',
  description:
    'Search the platform help documentation and return the passages that best ' +
    'answer a question about HOW THIS APP WORKS — booking, cancelling, the ' +
    'waitlist, what this assistant can and cannot do, and privacy or account ' +
    'policy. Pass the patient\'s question as `query`, in their own words.\n\n' +
    'This is NOT where facts about a particular doctor live. Fees, hours, ' +
    'specialities, locations and free slots come from search_doctors, ' +
    'get_doctor and check_availability, which read them live and exactly — use ' +
    'those instead, and never answer "is Dr. X free on Tuesday?" from here.\n\n' +
    'Returns up to three passages with a title and a similarity score, most ' +
    'relevant first. An EMPTY result means the documentation does not cover ' +
    'the question — say so plainly rather than guessing or filling the gap.',
  schema,
  mutates: false,

  // ctx is unused: this documentation is the same for every patient, and there
  // is nothing here scoped to one. Rule 3 is satisfied trivially — the tool has
  // no identity to get wrong, because it reads nothing about anybody.
  handler: async (ctx, args) => retrieve(() => embedQuery(args.query)),
};
