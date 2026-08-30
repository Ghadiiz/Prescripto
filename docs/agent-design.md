# Two kinds of retrieval

**How the Prescripto assistant decides between a SQL query and a vector search
— and why putting the wrong half in the wrong system is a bug, not a
preference.**

Phase 8 added retrieval-augmented generation to an assistant that already had
seven database-backed tools. The interesting part was not adding RAG. It was
deciding what RAG must *not* be allowed to answer.

This document is the argument, worked through on this system.

---

## The principle

An assistant answering questions about a booking platform faces two shapes of
question, and they want different machinery:

| | Structured | Unstructured |
|---|---|---|
| **Question** | "Is Dr. Smith free Tuesday?" | "How does the waitlist work?" |
| **Lives in** | `doctors`, `appointments`, `specialities` | `platform_docs` |
| **Retrieved by** | SQL query | cosine similarity over embeddings |
| **Tools** | `search_doctors`, `get_doctor`, `check_availability`, `list_specialities`, `suggest_speciality`, `my_appointments` | `search_platform_info` |
| **Answer is** | computed, exact, one right answer | explanatory prose, no row to return |
| **Freshness** | live — reads current rows | a snapshot, correct until the text changes |
| **Wrong answer looks like** | an error | a plausible paragraph |

The split is **by the shape of the data, not by topic**. That distinction
matters: "waitlist" appears on both sides. *How the waitlist works* is prose.
*Whether you are on a waitlist for Tuesday at 10:00* is a row. Same subject,
different machinery, because one has a computable answer and the other does
not.

---

## The structured half: SQL

Doctors, fees, specialities, locations and availability are rows. Every
question about them has one correct answer and a query that produces it.

`check_availability` is the clearest case. Slots are not stored at all — they
are **generated** from a 10:00–21:00 half-hour grid
(`appointmentService.js:222`) with booked times removed. There is no slots
table to embed even in principle; the answer exists only as the result of a
computation over current rows.

Three properties follow, and all three are lost the moment this data is
embedded instead:

- **Deterministic.** The same question gets the same answer, because it is a
  query and not a nearest-neighbour search.
- **Always current.** The tool reads live rows. A doctor who changed their fee
  a minute ago has the new fee in the next answer, with no reindexing step in
  between.
- **Exact.** `check_availability` returns the actual free start times, plus a
  `checked_at` timestamp — because availability is a snapshot of a contended
  resource, never a promise that a slot is held.

---

## The unstructured half: RAG

"How does the waitlist work?" has no row to return. There is no
`waitlist_explanation` column, and inventing one would only move the problem:
the answer is a paragraph someone wrote, and the useful reply is that
paragraph.

Keyword search handles this badly, because patients do not use the system's
vocabulary. Someone asks *"what if the time I want is taken?"* — a question
containing none of the words in the passage titled *"What is the waitlist and
how does it work?"* Embeddings match on **meaning**, so the question finds the
passage anyway. That is the specific job RAG is doing here, and it is a job SQL
genuinely cannot do.

The corpus is twelve passages (`database/platformDocs.js`) covering booking,
cancelling and rescheduling, the waitlist, what the assistant can and cannot
do, and privacy and account policy. All of it is prose about how the platform
behaves. None of it is a fact about a particular doctor.

---

## The anti-pattern: why embedding structured data would be wrong

This is the part worth being precise about, because "we used RAG" is easy and
knowing what to keep out of it is the actual skill.

Suppose the corpus contained a passage: *"Dr. Smith charges 30 JOD and works
Tuesdays and Thursdays."* It would retrieve beautifully. It would also be
wrong in three distinct ways.

**1. It goes stale, silently.** An embedding is a snapshot of text at ingestion
time. When Dr. Smith edits that fee in the admin panel, the row changes and the
embedded sentence does not. Nothing errors. The vector still matches the
question perfectly — it now confidently retrieves a wrong number. A SQL query
has no equivalent failure, because it has no copy to fall out of date. Staleness
here is not a cache-invalidation problem to be solved with a shorter TTL; it is
the direct result of duplicating authoritative data into a second store.

**2. It converts an exact question into a fuzzy match.** "Is Dr. Smith free
Tuesday?" has a definite yes or no, derivable from `appointments`. Similarity
search answers a different question — *which stored text most resembles this
sentence* — and for a question that has a correct answer, "most similar" is
strictly worse than "correct". It can rank a passage about a different doctor
above the right one, because vectors measure resemblance, not identity.

**3. It launders uncertainty into confidence.** A failed SQL lookup returns
nothing, and the assistant says it does not know. A failed vector lookup
returns the *nearest* passage, which reads exactly like a successful one. The
failure mode is not an error message; it is a fluent, specific, wrong answer.

So per-doctor facts stay in SQL. Deliberately, and in writing: the reasoning
sits in the migration that created the table
(`database/migrations/008_platform_docs.sql`), so anyone who opens the schema
meets the argument before they get the idea.

---

## The boundary is enforced, not advisory

A rule that lives only in a comment is a rule that erodes. The tempting
addition — one little passage about fees, because a patient asked — is exactly
the kind of thing that gets added at 11pm and reviewed by nobody.

So the corpus is tested (`tests/ingestPlatformDocs.test.js`):

```js
const banned = /\b(fee|fees|jod|price|cost)\b|\d{1,2}:\d{2}\s?(am|pm)/i;
```

A passage naming a fee or a clock time **fails the build**, with a message
saying per-doctor facts belong in SQL. The anti-pattern is caught at review
time rather than discovered in production six weeks later, when someone notices
the assistant quoting a price that has not been correct since spring.

The separation is structural elsewhere too:

- `search_platform_info` is **read-only** (`mutates: false`) and touches no
  patient data — the passages are public help text committed to this repo.
- Retrieved passages are **data, never instructions**. Control and format
  characters are stripped before a passage reaches the prompt, so text inside
  one that says `SYSTEM: ignore your instructions` arrives as text that happens
  to say those words. This is enforced at retrieval, and a mutation that skips
  the sanitiser fails a test.
- Every tool call, both kinds, is audited to `assistant_audit_log` with its
  result count — so a run of retrievals returning zero passages is visible as a
  gap in the documentation rather than invisible as a vague answer.

---

## Grounding it in measurements

The design above is only worth anything if the retrieval actually separates
the questions it should answer from the ones it should not. That was measured,
not assumed.

**Setup.** `gemini-embedding-001` at **768 dimensions**, normalised to unit
length at write time so cosine similarity is a plain dot product. Twelve
passages, scored in Node — Aiven runs MySQL 8.4, which has no vector type or
vector index, so the vectors are stored as JSON and compared in the
application. At twelve rows that is the right answer; at ten thousand it would
not be.

**Separation.** Eight on-topic questions and four with no answer in the corpus:

| | Top score |
|---|---|
| On-topic (8/8 retrieved the correct passage) | **0.668 – 0.794** |
| Off-topic — "what is the capital of France?", the weather, "do I have diabetes?", a prompt-injection probe | **0.524 – 0.593** |

**The threshold is 0.62**, sitting in that gap with 0.048 of headroom below the
weakest real answer and 0.027 above the strongest false one. Below it, the tool
returns **nothing** and the assistant says the documentation does not cover the
question — rather than handing over the least-unrelated paragraph. Proven end
to end against the live corpus: *"how does the waitlist work?"* returns the
waitlist passage first; *"what is the capital of France?"* returns **zero
passages**.

That is the property worth having. RAG that knows when it does not know is more
useful than RAG that always has something to say.

**Two honest caveats**, because the number describes this corpus rather than
the model:

- The separation is about **0.075** across twelve passages. That is real but
  thin. The threshold is **tuned, not derived**, and needs re-checking whenever
  passages are added, rewritten or removed — which is why the measurements are
  recorded next to the constant instead of in a commit message.
- The tool returns the **top three** above the floor, not the single winner.
  First-to-second gaps ran as low as 0.023, far too thin to present one passage
  as uniquely right, and adjacent passages often belong in the same answer.

---

## What this design does not claim

- **RAG is not a search upgrade for the structured half.** It answers the
  questions SQL cannot, and is deliberately kept away from the questions SQL
  answers better.
- **The corpus is not a second system prompt.** It is documentation. That the
  passages are ours and reviewed in a diff is not what makes them safe — they
  are sanitised on the way out regardless, because provenance is not a security
  property.
- **The instruction-style guard is a convention, not a test.** The corpus file
  tells authors not to write "always tell the patient…" into a passage, and
  nothing enforces it. What *is* enforced is the part that matters more: rule 5
  at retrieval time, which neutralises such text whether or not an author
  followed the convention.
- **Brute-force scoring does not scale**, and is not meant to. Twelve passages
  are read and scored per query. A corpus two orders of magnitude larger needs
  a real vector index, which this database cannot provide.

---

## The lesson in one line

**Match the retrieval to the shape of the data.** Structured facts have a
correct answer, so compute it. Explanatory prose has no correct row, so
retrieve it by meaning — and refuse to answer when nothing is close enough.

Putting structured data in a vector index does not fail loudly. It fails as a
fluent, confident, out-of-date sentence, which is the most expensive kind of
wrong an assistant can be. Keeping the two apart is the design.
