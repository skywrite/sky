---
created: 2026-10-01
updated: 2026-10-01
---

# Chat context improvements

Ideas to revisit for reducing unnecessary notebook work during attachment
edits and conversation follow-ups. The current design lives in the
[chat host's notes](../../src/service/handler/chat/docs/README.md#ask-first-whether-a-message-needs-the-notebook-experimental).

- [ ] Give Jev better input: attachment types, the active document and
  available source references, plus enough of the latest exchange to retain
  the proposal the user is answering. The current first-400-character
  excerpts can omit that proposal. Keep the decision input bounded.
- [ ] Require the query generator to identify missing notebook evidence
  before producing new queries. Editing supplied content or working on a
  known external document should allow no additional notebook lookup;
  read that document directly when its current contents are needed.
- [ ] Defer baseline gathering until the preflight decides a first notebook
  reading is needed. Session startup currently seeds the baseline before
  that decision. Preserve restoration and the ability to gather later.
- [ ] Distinguish using attachments, reusing existing context, and running
  new searches in chat activity. Keep raw GraphQL and token-budget
  adjustments available in details; inherited queries should not look like
  fresh searches.
- [ ] Evaluate routing with synthetic attachment edits, approvals, new
  personal questions, and mixed requests such as revising an Atlas draft
  using a newly requested meeting. Measure unnecessary reads, missed
  evidence, and response latency separately for first readings and
  follow-ups. Mocked probabilities test wiring, not the model's judgment.
- [ ] Investigate a smaller working context for simple follow-ups separately
  from the decision to search. Compare answer quality, latency, and cache
  behavior before changing the assembly carried between turns; skipping a
  search still retains that assembly today.

These changes trade retrieval cost against missing evidence and conversation
continuity. Evaluate them individually before combining them or raising
thresholds further.
