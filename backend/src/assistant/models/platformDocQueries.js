import { getDB } from '../../config/mysql.js';

// SQL for the platform documentation corpus — Phase 8's RAG passages.
//
// Same contract as every other file in here: an explicit column list, never
// `SELECT *` (rule 4, machine-enforced since 6.10). There is nothing sensitive
// in this table — it holds help-centre prose written by us — but the column
// list is not about this table's contents. It is about the next column someone
// adds to it, which a `*` would start returning without anyone deciding to.
//
// The whole corpus, unfiltered. Two reasons, and neither is laziness:
//
//   MySQL 8.4 has no vector index, so there is no WHERE clause that could
//   narrow by similarity — scoring happens in Node either way.
//
//   The corpus is a dozen short passages. Reading all of them costs about
//   140 KB at 768 dimensions, which is cheaper than the round trip that would
//   fetch a subset.
//
// If this ever grows to the point where that is untrue, the fix is a real
// vector store, not a cleverer query here.
export const listPlatformDocs = async () => {
  const db = getDB();

  const [docs] = await db.query(
    `SELECT slug, title, content, source, embedding, embedding_model, embedding_dim
       FROM platform_docs
      ORDER BY id`,
  );

  return docs;
};
