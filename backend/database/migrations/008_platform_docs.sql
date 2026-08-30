-- 008 — platform documentation passages and their embeddings.
--
-- Phase 8 adds a SECOND KIND of retrieval, and the whole point of the phase is
-- that it is kept separate from the first by the SHAPE OF THE DATA:
--
--   STRUCTURED  -> SQL. Doctors, fees, specialities, locations, availability.
--                  Rows with computable answers, already served by the tools
--                  built in Phases 1-7. "Is Dr. Smith free Tuesday?" has one
--                  correct answer and a query that finds it.
--
--   UNSTRUCTURED -> this table. How booking works, how the waitlist works,
--                  what the assistant can and cannot do, platform policy.
--                  Explanatory prose with no SQL answer.
--
-- Per-doctor facts DO NOT BELONG HERE. Embedding them would bury computable
-- rows in a vector index, where they go stale the moment a doctor edits a fee
-- and where an exact question becomes a similarity search. That is the
-- anti-pattern this phase exists to demonstrate against.
--
--
-- WHY EMBEDDINGS ARE JSON RATHER THAN A VECTOR TYPE
--
-- Aiven runs MySQL 8.4, which has no vector type and no vector index. For a
-- corpus of roughly fifteen short passages the standard answer is to store the
-- vector as JSON and compute cosine similarity in the application: fifteen
-- rows are scanned either way, so an index would buy nothing even if one
-- existed. No pgvector, no MySQL 9, no second datastore.


CREATE TABLE platform_docs (
  id INT PRIMARY KEY AUTO_INCREMENT,

  -- The stable identity of a passage, and the reason ingestion is safe to
  -- re-run. 8.2's script writes these documents every time the prose is
  -- edited; without a key to upsert on, each run would append a second copy of
  -- every passage and retrieval would start returning duplicates of itself.
  --
  -- The same device `appointments.active_slot` and `waitlist.active_request`
  -- use, for the same reason: idempotency is a DATABASE guarantee, not a check
  -- the script has to remember to make.
  slug VARCHAR(64) NOT NULL,

  -- Shown to the patient as the citation for a retrieved passage.
  title VARCHAR(160) NOT NULL,

  -- The passage itself. TEXT because these are paragraphs, not documents —
  -- long enough to answer a question, short enough to embed as one unit.
  content TEXT NOT NULL,

  -- Where the prose came from, when that is worth saying alongside the title.
  -- Nullable: most passages are their own source.
  source VARCHAR(160) NULL DEFAULT NULL,

  -- The vector, as a JSON array of floats.
  --
  -- NOT NULL deliberately. A row that exists but cannot be searched is a state
  -- 8.3 would have to defend against on every query, forever, and the
  -- ingestion script holds the content and the vector at the same moment — so
  -- there is no reason to permit the half-written row in the first place.
  embedding JSON NOT NULL,

  -- WHAT PRODUCED THE VECTOR, and this is a guardrail rather than bookkeeping.
  --
  -- Cosine similarity between vectors from two different models is not an
  -- error. It is a number. Nothing throws, nothing logs, and the rankings just
  -- quietly become noise. Recording the model and the dimension lets 8.3
  -- refuse to compare across them instead of silently returning bad passages
  -- with a confident tone.
  --
  -- The dimension is stored rather than fixed in the column type because
  -- gemini-embedding-001 can emit 3072 (its default) or a truncated 768/1536,
  -- and 8.2 should be free to choose without a migration.
  embedding_model VARCHAR(64) NOT NULL,
  embedding_dim SMALLINT UNSIGNED NOT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_slug (slug)

  -- No other index. There is no vector index to be had on 8.4, and every
  -- query reads the whole (tiny) table to score it, so anything else would be
  -- decoration.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
