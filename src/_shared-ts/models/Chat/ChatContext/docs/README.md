---
created: 2026-08-15
updated: 2026-09-05
---

# ChatContext admission — one scorer, question-conditioned policy

Per-turn timing is stored with the context log by the session; see
[shared timing](../../../../timing/docs/README.md) for measurement and persistence semantics.

ChatContext decides the candidate pool; `ContextAssembler` decides what
fits the budget. Between them sits the **admission policy** — how scored
docs become the kept set — and it is the one piece that is conditioned on
the question's shape:

- **`rank`** (default): relevance floor, then a global score-rank walk to
  the budget. Right for now-shaped questions, where the s3 recency prior
  encodes a true belief.
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
(`summaryBaseline`, the CLI default) days before yesterday seed from their
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
- **The reserve bypasses the relevance floor.** Inside an asked-for
  window, a weak thin capture is the era's only witness, not padding.
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

1. `CHAT_SCORE.sweepReserveDocs` / `sweepReserveTokens` — per-month
   guarantee size.
2. Slice granularity — month, matching the corpus layout and the observed
   failure grain (whole months blacked out).
3. Recency-prior flattening for sweep questions only — next dial if
   stratification proves insufficient; one parameter, not a second scorer.
4. Sweep budget boost — parked; see the incident file for why it does not
   fix coverage.
