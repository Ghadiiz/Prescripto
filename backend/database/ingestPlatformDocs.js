import 'dotenv/config';

import { connectDB, getDB } from '../src/config/mysql.js';
import {
  embedDocuments,
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
} from '../src/assistant/embeddings.js';
import { platformDocs } from './platformDocs.js';

// Makes `platform_docs` match `platformDocs.js`, which is the source of truth.
//
// Run by hand, like migrate and seed: `npm run ingest:docs`.
//
// NO LOCALHOST GUARD, deliberately, and this is the difference from seed.js.
// The seed wipes every table and must never see production. This script is
// MEANT to run against Aiven eventually — the corpus has to exist in
// production or the assistant retrieves nothing there. What it does instead is
// say exactly what it did, so the outcome is never a guess.

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Title AND content, because the title does real retrieval work: a passage
// called "What is the waitlist and how does it work?" should match a question
// about waitlists even where the body never repeats the word. It also means
// editing a title is a content change as far as re-embedding is concerned.
export const embeddableText = (doc) => `${doc.title}\n\n${doc.content}`;

// Refuses the WHOLE run rather than skipping the bad entries. A partial corpus
// is worse than none: the missing passages fail silently at retrieval time,
// where the symptom is a vague answer rather than an error anyone can trace.
export const validate = (docs) => {
  const problems = [];
  const seen = new Set();

  for (const doc of docs) {
    const where = doc.slug || '(missing slug)';

    if (!doc.slug || !SLUG_PATTERN.test(doc.slug)) {
      problems.push(`${where}: slug must be lower-case words separated by hyphens`);
    }
    if (seen.has(doc.slug)) {
      problems.push(`${where}: duplicate slug`);
    }
    seen.add(doc.slug);

    if (!doc.title?.trim()) problems.push(`${where}: title is empty`);
    if (!doc.content?.trim()) problems.push(`${where}: content is empty — write the passage first`);
  }

  return problems;
};

// What actually needs re-embedding. Reading the existing rows first turns
// "edit one passage" into one embedding call rather than twelve — which
// matters on a free tier, and matters more every time the prose is revised.
//
// The model and dimension are part of the comparison on purpose: a vector
// produced by a different model is not comparable with the others, and 8.3
// refuses to mix them. Changing either must therefore re-embed everything, and
// this is what notices.
export const planChanges = (docs, existingRows) => {
  const existing = new Map(existingRows.map((row) => [row.slug, row]));

  const toEmbed = [];
  const unchanged = [];

  for (const doc of docs) {
    const row = existing.get(doc.slug);

    const same =
      row &&
      row.title === doc.title &&
      row.content === doc.content &&
      row.embedding_model === EMBEDDING_MODEL &&
      Number(row.embedding_dim) === EMBEDDING_DIM;

    if (same) unchanged.push(doc);
    else toEmbed.push({ doc, isNew: !row });
  }

  const wanted = new Set(docs.map((doc) => doc.slug));
  const orphans = existingRows
    .map((row) => row.slug)
    .filter((slug) => !wanted.has(slug));

  return { toEmbed, unchanged, orphans };
};

const run = async () => {
  const problems = validate(platformDocs);

  if (problems.length) {
    console.error('\nRefusing to ingest — the corpus is not ready:\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      `\nNothing was written. ${problems.length} problem(s) in ` +
        'database/platformDocs.js.\n',
    );
    process.exitCode = 1;
    return;
  }

  await connectDB();
  const db = getDB();

  // WHICH DATABASE THIS IS WRITING TO.
  //
  // 8.2 confirmed a production run had reached Aiven by reading the counts:
  // the local table already held twelve rows, so "to embed: 12" could only
  // mean an empty remote one. That was a TIMING COINCIDENCE, not a safeguard —
  // now that both databases are populated the counts look identical either
  // way, and the only thing distinguishing them is this line.
  console.log(
    `\nConnected to ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}` +
      ` / ${process.env.DB_NAME}` +
      `${process.env.DB_SSL === 'true' ? ' (SSL)' : ''}`,
  );

  const [existingRows] = await db.query(
    'SELECT slug, title, content, embedding_model, embedding_dim FROM platform_docs',
  );

  const { toEmbed, unchanged, orphans } = planChanges(platformDocs, existingRows);

  console.log(`\n${platformDocs.length} passage(s) in the corpus.`);
  console.log(`  unchanged      : ${unchanged.length}`);
  console.log(`  to embed       : ${toEmbed.length}`);
  console.log(`  to prune       : ${orphans.length}`);

  if (toEmbed.length) {
    console.log(`\nEmbedding ${toEmbed.length} passage(s) with ${EMBEDDING_MODEL}...`);

    const vectors = await embedDocuments(
      toEmbed.map(({ doc }) => embeddableText(doc)),
    );

    for (const [index, { doc, isNew }] of toEmbed.entries()) {
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
          doc.slug,
          doc.title,
          doc.content,
          doc.source ?? null,
          JSON.stringify(vectors[index]),
          EMBEDDING_MODEL,
          vectors[index].length,
        ],
      );

      console.log(`  ${isNew ? 'inserted' : 'updated '}  ${doc.slug}`);
    }
  }

  // Pruned LOUDLY. The file is the source of truth, so a passage deleted from
  // it but left in the table is a passage still being shown to patients that
  // the team believes is gone — a worse outcome than a DELETE in a script
  // whose entire job is to make the table match the file.
  for (const slug of orphans) {
    await db.query('DELETE FROM platform_docs WHERE slug = ?', [slug]);
    console.log(`  pruned    ${slug}  (no longer in platformDocs.js)`);
  }

  const [[{ total }]] = await db.query(
    'SELECT COUNT(*) AS total FROM platform_docs',
  );

  console.log(`\nDone. platform_docs now holds ${total} passage(s).\n`);

  await db.end();
};

// Only when run directly, so the tests can import the pure helpers above
// without the script executing itself.
if (process.argv[1] && process.argv[1].endsWith('ingestPlatformDocs.js')) {
  run().catch((error) => {
    console.error(`\nIngestion failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export { run };
