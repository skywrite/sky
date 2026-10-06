---
created: 2026-08-15
updated: 2026-10-05
---

# ChatContext admission — evidence in, budget as a cap

Per-turn timing is stored with the context log by the session; see
[shared timing](../../../../timing/docs/README.md) for measurement and persistence semantics.

Full query sets also travel as `context-queries` progress events, including
initial queries with zero matches. The web presentation and read-back
contract live in the [chat HTTP notes](../../../../../service/handler/chat/docs/2026-09-06-queries-beside-the-wait.md).

Fitting the final model request can lower retrieval below the selected allowance;
see [conversation capacity](../../docs/README.md#fitting-a-conversation-to-its-model).

The baseline and retrieval honor the conversation boundaries described in
[reply threads](../../../../../service/handler/chat/docs/README.md#reply-threads),
including the reply directories of the current conversation and its ancestors.

ChatContext decides the candidate pool; `ContextAssembler` decides what
fits the budget. Between them sits the **admission policy** — how scored
docs become the kept set.

A document is admitted by **evidence**, never by budget room (scoring
`s5`, 2026-10-04). It ships when one of these holds:

- a query returned it, at any tier, on any turn of the conversation
  (`prov` on its record);
- its lexical match clears the admission bar, `CHAT_SCORE.admissionLex`
  (4 of 8): a near-unique header or name match, or a few good matches
  combined — never one grazing word in a long message;
- it is **ambient core**: a day's ledger (`day.md`) or summary inside the
  baseline window, one line per capture and the digest of each day, so the
  model knows what the week held even when the question names none of it;
- it is pinned (goals, pending decisions, the week plan, the person's pins).

Everything else is refused (`cut: 'floor'`, counted in `stats.floored`;
`stats.floor` records the bar). The budget then caps the admitted set; it is
no longer a target. The relative floor this replaced (35% of the turn's top
score) let a same-day message with recency 5 + type 2 + one grazing match
clear ~8, so the budget filled on 79% of turns and half of what shipped had
no query behind it (measured over 30 days, 2026-10-04). The scorer itself is
unchanged: it still orders the admitted set for the budget walk.

## Delivery is append-only

The first assembly is rendered once, as the context segment of the system
prompt, and that segment is byte-identical from turn to turn. A document
admitted on a later turn — a query hit, a baseline document the conversation
moved onto, a pin — is rendered as an **addition** that the session places
at the head of the person's next user message, as a labeled block followed
by their words. (The AI SDK takes system messages only through
`instructions`, at the front of the request; a system message inside
`messages` is refused whatever the provider supports — seen live on Opus
5.5, 2026-10-04.) The admission rank walk holds shipped documents and only
places newcomers in the room the cap leaves. This governs normal delivery;
the outgoing working context may compact previously retrieved text when the
whole request approaches the model's limit. Saved history retains the original.

Without a capacity reduction, the request grows only at its end, which is what both providers'
prompt caches reward. Before this, two of every three turns rewrote the
whole segment, 81% of it the same documents as the turn before, and cache
writes were 95% of the chat bill (30 days to 2026-10-04).

OpenAI needs one more thing to read that prefix back: a stable
`prompt_cache_key` per conversation, which routes the request to the cache
that holds it. Without one, six of eight unchanged GPT-6 turns in the 30 days
read nothing. The session sends its conversation key (the web thread id, the
terminal's process id) through `ChatEngineOptions.cacheKey`; Anthropic keys
its cache by the prefix alone and never sees it.

Two consequences to know:

- `fitForRequest` refits the **segment**. If that is insufficient, the
  engine compacts identified addition blocks into rereadable source references
  in its outgoing request, preserving the person's words and full saved history.
  See [conversation capacity](../../docs/README.md#fitting-a-conversation-to-its-model)
  for the boundary and recovery contract. A document the segment refit drops
  leaves the shipped set and may be admitted again later.
- Keeping a document out by hand (`exclude`) stops its future admission and
  re-renders the segment without it, but an addition already delivered
  cannot be unsaid; the log and the story say it is excluded from here on.

`RebuildReport.activityMarkdown` is the segment, `additionsMarkdown` the
newcomers; the turn log records them as `added`, which the Context story
lists beside the query diff.

The policy is otherwise conditioned on the question's shape:

- **`rank`** (default): the admitted set, score-rank walked to the cap.
- **`sweep-stratified`**: armed when the user *stated* a window ("since
  Feb", "from X through Y") — the same explicit signal that widens
  `recent:` and uncaps `limit` upstream. Every month of the stated window
  is guaranteed its best docs (up to `CHAT_SCORE.sweepReserveDocs` /
  `sweepReserveTokens`, oldest month funded first, drawing from floored
  docs too) before the rank walk fills the remainder. The window is
  [start ‖ today − since, until ‖ today], where `start` is the user's
  stated range start when the extractor resolved one (stats: `sweepFrom`).
  Mechanism: `ContextAssembler` `ReserveOptions`; wiring: `sweepReserve()`
  in mod.ts.

The candidate pool is policy too. Under the lean baseline
(`summaryBaseline`, every host's default — shared in
`commands/lib/chat/readingDefaults.ts`) days before yesterday seed from their
summary.md — or the day.md ledger alone — and today and yesterday seed
whole **minus message-capture bodies**: day.md ledgers every capture at a
line each, and retrieval fetches any body a conversation asks about. See
[2026-09-01](2026-09-01-lean-baseline-drops-message-bodies.md) for the
capture-volume shift that forced this.

The scorer never changes — s3 answers "how much evidence does this one doc
carry?", which no policy needs re-answered. What changes is the set-level
objective: rank maximizes summed scores; a stated sweep also owes the user
*coverage of the window they named*, a property of the set that no per-doc
score can express. See the [2026-08-15 incident](2026-08-15-sweep-pruning-starved-stated-window.md)
for the failure that forced the distinction.

Design rulings behind it (so future tweaks argue with the reasons, not
guesses):

- **Floors, never ceilings.** The policy only ever adds representation;
  no stated date or window ever shrinks what rank would keep. Planning
  questions and casual chats carry no signal and are byte-identical rank.
- **The reserve bypasses admission.** Inside an asked-for window, a weak
  thin capture is the era's only witness, not padding.
- **Representation, not equal share.** Proportional per-slice token
  shares were rejected: they starve the recent months that genuinely
  carry more signal. The reserve is a small guarantee (~5 docs / ~5k
  tokens per month); rank still allocates the bulk.
- **Budget size is the wrong first lever.** A simulated 500k budget under
  rank still left the earliest stated month empty — score-ranked fill
  buys more of the newest flood before it buys the starved era. A sweep
  budget boost stays parked as a *secondary* dial.
- **Every policy run is legible.** Turn stats record `policy` and `sweep`;
  reserve-kept docs carry `via: "reserve"` in the universe/diff records.
  A resumed session re-arms the policy from the recorded stats.

## Dials (in tuning order)

0. `CHAT_SCORE.admissionLex` — the evidence a document without provenance
   needs. Lower admits more ambient material; raise it if topical noise
   still rides in on common words.
1. `CHAT_SCORE.sweepReserveDocs` / `sweepReserveTokens` — per-month
   guarantee size.
2. Slice granularity — month, matching the corpus layout and the observed
   failure grain (whole months blacked out).
3. Recency-prior flattening for sweep questions only — next dial if
   stratification proves insufficient; one parameter, not a second scorer.
4. Sweep budget boost — parked; see the incident file for why it does not
   fix coverage.

## Notes

- [2026-10-04 — admission by evidence, and context that only grows](2026-10-04-admission-by-evidence-and-append-only-delivery.md): why the budget stopped being a target and why later documents arrive as additions.
- [2026-09-01 — the lean baseline drops message bodies](2026-09-01-lean-baseline-drops-message-bodies.md)
- [2026-08-15 — sweep pruning starved the stated window](2026-08-15-sweep-pruning-starved-stated-window.md)

## Verified

- 2026-10-04 — live on the web path, throwaway threads never kept: Opus 5.5 wrote 195,140 tokens on turn one and read 193,942 while writing 13,603 on turn two; Haiku read 145,603 and wrote 10,887. GPT-6 Astra read nothing on turn two until the conversation key went out as its prompt cache key, then read 124,055 and wrote 7,189 — the same on the direct run (66,563 read, 5,680 written).
- 2026-10-04 — live, the real session class against the running notebook with a real model, nothing saved: Haiku 4.5 seeded 104 documents, admitted 19 (62k estimated tokens) on turn one and refused 85; turn two admitted ten more and read 76,785 tokens from cache while writing 6,436 — the addition and the new message. Before the render order was fixed by path, the same turn re-wrote all 83k: a segment rendered in score order changes bytes as the scores move. Opus 5.5, same first turn: 104k tokens written for the same 62k estimated — the 1.7× estimate drift.
- 2026-10-04 — unit: the assembler's `eligible` predicate and path-ordered subset render; ChatContext admission (query hit, ledger, and pinned goal ship; an off-topic journal and summary are refused), a refused journal admitted when the topic moves onto it, a shipped journal held after its evidence fades with the newcomer delivered apart, a refit shrinking the segment only; ChatSession delivery as a labeled block at the head of the user message, the segment byte-identical across turns.
