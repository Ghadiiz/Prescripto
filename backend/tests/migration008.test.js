import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { connectDB, getDB } from '../src/config/mysql.js';

// The 008 constraints, exercised against the real database — the same bet
// migration006 and migration007 make.
//
// Two things here are worth proving rather than describing:
//
//   The UNIQUE slug is what makes 8.2's ingestion safe to re-run. The script
//   will be run every time the prose is edited, and without a key to upsert on
//   each run appends a second copy of every passage — retrieval then returns
//   a document alongside its own duplicate, and nothing looks broken.
//
//   The JSON round-trip is the assumption the WHOLE PHASE rests on. If a float
//   array does not come back as a float array of the same length and values,
//   cosine similarity in 8.3 scores garbage — and it scores it silently,
//   because a wrong number is still a number. Better to find that out here
//   than to debug rankings later.

let db;

const MODEL = 'gemini-embedding-001';

// A recognisable pattern rather than random noise: if a value comes back
// altered, the shape of the damage says what happened.
const vector = (dims) =>
  Array.from({ length: dims }, (_, i) => (i % 2 ? -1 : 1) * (i + 1) / 100000);

before(async () => {
  const dbHost = process.env.DB_HOST || '';
  if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
    throw new Error(
      `Refusing to run tests: DB_HOST is "${dbHost}", not localhost. ` +
        'These tests insert and delete rows.',
    );
  }

  await connectDB();
  db = getDB();
});

after(async () => {
  await db.query("DELETE FROM platform_docs WHERE slug LIKE 'test-008-%'");
  await db.end();
});

beforeEach(async () => {
  await db.query("DELETE FROM platform_docs WHERE slug LIKE 'test-008-%'");
});

const insert = ({
  slug = 'test-008-a',
  title = 'How the waitlist works',
  content = 'A waitlist entry is one specific day and time.',
  source = null,
  embedding = vector(8),
  model = MODEL,
  dims,
} = {}) =>
  db.query(
    `INSERT INTO platform_docs
       (slug, title, content, source, embedding, embedding_model, embedding_dim)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
    [
      slug,
      title,
      content,
      source,
      embedding === null ? null : JSON.stringify(embedding),
      model,
      dims ?? (embedding === null ? 0 : embedding.length),
    ],
  );

const rejects = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}`);
    return true;
  });
};

// --- idempotent ingestion ----------------------------------------------------

test('the same slug twice collides, so re-ingestion is an upsert', async () => {
  await insert({ slug: 'test-008-waitlist' });

  await rejects(insert({ slug: 'test-008-waitlist' }), 'ER_DUP_ENTRY');
});

test('an upsert on the slug replaces rather than duplicating', async () => {
  await insert({ slug: 'test-008-waitlist', content: 'first draft' });

  // The shape 8.2's script will use.
  await db.query(
    `INSERT INTO platform_docs
       (slug, title, content, source, embedding, embedding_model, embedding_dim)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       content = VALUES(content),
       source = VALUES(source),
       embedding = VALUES(embedding),
       embedding_model = VALUES(embedding_model),
       embedding_dim = VALUES(embedding_dim)`,
    [
      'test-008-waitlist',
      'How the waitlist works',
      'second draft',
      null,
      JSON.stringify(vector(8)),
      MODEL,
      8,
    ],
  );

  const [rows] = await db.query(
    "SELECT content FROM platform_docs WHERE slug = 'test-008-waitlist'",
  );

  assert.equal(rows.length, 1, 're-ingestion created a second copy');
  assert.equal(rows[0].content, 'second draft');
});

test('different slugs coexist', async () => {
  await insert({ slug: 'test-008-a' });
  await insert({ slug: 'test-008-b' });

  const [[{ count }]] = await db.query(
    "SELECT COUNT(*) AS count FROM platform_docs WHERE slug LIKE 'test-008-%'",
  );
  assert.equal(count, 2);
});

// --- no unsearchable rows ----------------------------------------------------

test('a row cannot exist without an embedding', async () => {
  // The state 8.3 would otherwise have to defend against on every query.
  await rejects(insert({ embedding: null }), 'ER_BAD_NULL_ERROR');
});

test('a row cannot exist without the model that produced it', async () => {
  await rejects(
    db.query(
      `INSERT INTO platform_docs (slug, title, content, embedding, embedding_dim)
       VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
      ['test-008-nomodel', 'T', 'C', JSON.stringify(vector(8)), 8],
    ),
    'ER_NO_DEFAULT_FOR_FIELD',
  );
});

// --- the assumption the phase rests on ---------------------------------------

for (const dims of [768, 3072]) {
  test(`a ${dims}-dimension vector round-trips exactly`, async () => {
    const sent = vector(dims);
    await insert({ slug: `test-008-dim-${dims}`, embedding: sent, dims });

    const [[row]] = await db.query(
      'SELECT embedding, embedding_dim FROM platform_docs WHERE slug = ?',
      [`test-008-dim-${dims}`],
    );

    // mysql2 parses a JSON column into a value, so this should already be an
    // array rather than a string. If that ever changes, 8.3's scoring breaks
    // in a way that produces numbers rather than errors.
    const got = typeof row.embedding === 'string'
      ? JSON.parse(row.embedding)
      : row.embedding;

    assert.ok(Array.isArray(got), 'the embedding came back as a non-array');
    assert.equal(got.length, dims);
    assert.equal(row.embedding_dim, dims);
    assert.deepEqual(got, sent, 'values were altered in storage');
  });
}

test('negative and small-magnitude values survive', async () => {
  // Real embedding components are small and signed — the values measured from
  // gemini-embedding-001 were around -0.008249, 0.003413, 0.026227. A storage
  // path that rounded or dropped signs would still return an array.
  const sent = [-0.008249, 0.003413, 0.026227, -0.0000001, 0];
  await insert({ slug: 'test-008-precision', embedding: sent, dims: sent.length });

  const [[row]] = await db.query(
    "SELECT embedding FROM platform_docs WHERE slug = 'test-008-precision'",
  );
  const got = typeof row.embedding === 'string'
    ? JSON.parse(row.embedding)
    : row.embedding;

  assert.deepEqual(got, sent);
});

// --- housekeeping ------------------------------------------------------------

test('updated_at moves when a passage is re-ingested', async () => {
  await insert({ slug: 'test-008-touch' });

  const [[before]] = await db.query(
    "SELECT updated_at FROM platform_docs WHERE slug = 'test-008-touch'",
  );

  await new Promise((resolve) => setTimeout(resolve, 1100));
  await db.query(
    "UPDATE platform_docs SET content = 'edited' WHERE slug = 'test-008-touch'",
  );

  const [[after]] = await db.query(
    "SELECT updated_at FROM platform_docs WHERE slug = 'test-008-touch'",
  );

  assert.ok(
    new Date(after.updated_at) > new Date(before.updated_at),
    'ON UPDATE CURRENT_TIMESTAMP did not fire',
  );
});
