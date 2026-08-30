import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { connectDB, getDB } from '../src/config/mysql.js';
import { EMBEDDING_MODEL, EMBEDDING_DIM } from '../src/assistant/embeddings.js';
import {
  validate,
  planChanges,
  embeddableText,
} from '../database/ingestPlatformDocs.js';
import { platformDocs } from '../database/platformDocs.js';

// The ingestion pipeline.
//
// Split deliberately: the decisions (what is invalid, what needs re-embedding,
// what to prune) are pure functions tested against fixtures, and the upsert
// itself is tested against the real database. Neither half calls the embedding
// API — 8.2's client has its own suite, and paying quota to re-test it here
// would make this file slow, flaky and dependent on the network.

let db;

const doc = (over = {}) => ({
  slug: 'test-ingest-a',
  title: 'How the waitlist works',
  source: null,
  content: 'A waitlist entry is one specific day and time.',
  ...over,
});

const rowFor = (d, over = {}) => ({
  slug: d.slug,
  title: d.title,
  content: d.content,
  embedding_model: EMBEDDING_MODEL,
  embedding_dim: EMBEDDING_DIM,
  ...over,
});

before(async () => {
  const dbHost = process.env.DB_HOST || '';
  if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
    throw new Error(
      `Refusing to run tests: DB_HOST is "${dbHost}", not localhost.`,
    );
  }
  await connectDB();
  db = getDB();
});

after(async () => {
  await db.query("DELETE FROM platform_docs WHERE slug LIKE 'test-ingest-%'");
  await db.end();
});

beforeEach(async () => {
  await db.query("DELETE FROM platform_docs WHERE slug LIKE 'test-ingest-%'");
});

// --- what gets embedded ------------------------------------------------------

test('the title is embedded along with the content', () => {
  // It does real retrieval work: "What is the waitlist?" should match a
  // question about waitlists even where the body never repeats the word.
  const text = embeddableText(doc());

  assert.match(text, /How the waitlist works/);
  assert.match(text, /one specific day and time/);
});

// --- refusing an unfinished corpus -------------------------------------------

test('an empty passage refuses the whole run', () => {
  const problems = validate([doc(), doc({ slug: 'test-ingest-b', content: '  ' })]);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /test-ingest-b/);
  assert.match(problems[0], /content is empty/);
});

test('a duplicate slug is caught before the database has to', () => {
  const problems = validate([doc(), doc()]);

  assert.ok(problems.some((p) => /duplicate slug/.test(p)));
});

test('a malformed slug is refused', () => {
  for (const slug of ['Has Capitals', 'has_underscores', 'trailing-', '', 'has spaces']) {
    const problems = validate([doc({ slug })]);
    assert.ok(
      problems.some((p) => /slug must be/.test(p)),
      `${JSON.stringify(slug)} was accepted`,
    );
  }
});

test('a good corpus has no problems', () => {
  assert.deepEqual(validate([doc(), doc({ slug: 'test-ingest-b' })]), []);
});

// --- what needs re-embedding -------------------------------------------------

test('an unchanged passage is not re-embedded', () => {
  const d = doc();
  const { toEmbed, unchanged } = planChanges([d], [rowFor(d)]);

  assert.equal(toEmbed.length, 0, 'editing nothing should cost no embeddings');
  assert.equal(unchanged.length, 1);
});

test('a changed CONTENT is re-embedded', () => {
  const d = doc();
  const { toEmbed } = planChanges([d], [rowFor(d, { content: 'older text' })]);

  assert.equal(toEmbed.length, 1);
  assert.equal(toEmbed[0].isNew, false);
});

test('a changed TITLE is re-embedded too', () => {
  // Because the title is part of the embedded text. A change check that only
  // looked at content would leave the vector describing the old title.
  const d = doc();
  const { toEmbed } = planChanges([d], [rowFor(d, { title: 'Old heading' })]);

  assert.equal(toEmbed.length, 1);
});

test('a new passage is marked as new', () => {
  const { toEmbed } = planChanges([doc()], []);

  assert.equal(toEmbed.length, 1);
  assert.equal(toEmbed[0].isNew, true);
});

test('a different embedding MODEL forces a re-embed', () => {
  // Vectors from two models are not comparable, and 8.3 refuses to mix them —
  // so a model change has to invalidate the whole corpus, not sit there.
  const d = doc();
  const { toEmbed } = planChanges([d], [rowFor(d, { embedding_model: 'some-older-model' })]);

  assert.equal(toEmbed.length, 1);
});

test('a different DIMENSION forces a re-embed', () => {
  const d = doc();
  const { toEmbed } = planChanges([d], [rowFor(d, { embedding_dim: 3072 })]);

  assert.equal(toEmbed.length, 1);
});

test('a row whose slug left the file is pruned', () => {
  const d = doc();
  const { orphans } = planChanges(
    [d],
    [rowFor(d), rowFor(doc({ slug: 'test-ingest-deleted' }))],
  );

  assert.deepEqual(orphans, ['test-ingest-deleted']);
});

test('nothing is pruned when the file and the table agree', () => {
  const d = doc();
  assert.deepEqual(planChanges([d], [rowFor(d)]).orphans, []);
});

// --- the upsert, against the real database -----------------------------------

const upsert = (d, vector) =>
  db.query(
    `INSERT INTO platform_docs
       (slug, title, content, source, embedding, embedding_model, embedding_dim)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), content = VALUES(content), source = VALUES(source),
       embedding = VALUES(embedding), embedding_model = VALUES(embedding_model),
       embedding_dim = VALUES(embedding_dim)`,
    [
      d.slug,
      d.title,
      d.content,
      d.source ?? null,
      JSON.stringify(vector),
      EMBEDDING_MODEL,
      vector.length,
    ],
  );

test('re-ingesting the same slug replaces the row rather than adding one', async () => {
  const d = doc();
  await upsert(d, [0.1, 0.2]);
  await upsert({ ...d, content: 'second draft' }, [0.3, 0.4]);

  const [rows] = await db.query(
    "SELECT content FROM platform_docs WHERE slug LIKE 'test-ingest-%'",
  );

  assert.equal(rows.length, 1, 'ingestion duplicated a passage');
  assert.equal(rows[0].content, 'second draft');
});

test('pruning removes exactly the named row', async () => {
  await upsert(doc(), [0.1, 0.2]);
  await upsert(doc({ slug: 'test-ingest-keep' }), [0.3, 0.4]);

  await db.query('DELETE FROM platform_docs WHERE slug = ?', ['test-ingest-a']);

  const [rows] = await db.query(
    "SELECT slug FROM platform_docs WHERE slug LIKE 'test-ingest-%'",
  );
  assert.deepEqual(rows.map((r) => r.slug), ['test-ingest-keep']);
});

// --- the real corpus file ----------------------------------------------------

test('the real platformDocs.js is structurally sound', () => {
  // Passes while the prose is still being written, so the file is guarded from
  // the moment it exists rather than from the moment it is finished.
  const seen = new Set();

  for (const d of platformDocs) {
    assert.match(d.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad slug: ${d.slug}`);
    assert.ok(!seen.has(d.slug), `duplicate slug: ${d.slug}`);
    seen.add(d.slug);
    assert.ok(d.title?.trim(), `empty title on ${d.slug}`);
    assert.ok('content' in d, `${d.slug} has no content field at all`);
  }

  assert.ok(platformDocs.length > 0);
});

test('the real corpus carries no per-doctor structured facts', () => {
  // The anti-pattern guard. Fees, hours and availability are SQL's job; a
  // passage about them would go stale and would answer an exact question with
  // a similarity search. This catches the tempting addition at review time.
  const banned = /\b(fee|fees|jod|price|cost)\b|\d{1,2}:\d{2}\s?(am|pm)/i;

  for (const d of platformDocs) {
    const text = `${d.title} ${d.content}`;
    assert.ok(
      !banned.test(text),
      `${d.slug} looks like it names a fee or a clock time — per-doctor facts ` +
        'belong in SQL, not in the RAG corpus',
    );
  }
});
