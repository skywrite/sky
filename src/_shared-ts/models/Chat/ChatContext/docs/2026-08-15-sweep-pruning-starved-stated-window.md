---
status: shipped
created: 2026-08-15
updated: 2026-08-15
---

# A stated year-plus sweep kept zero docs from its oldest third

All figures rounded and relative to code constants; the reviewed chat was
a person-assessment question over a stated window of more than a year.

## Symptom

The window layer had just been fixed (`ai:context` coverage guard), so the
queries fetched the whole stated span — a universe of roughly 2× the 300k
budget. Score-rank pruning then reassembled the old failure one layer up:
the oldest third of the stated window kept **zero** documents, while the
newest few weeks held ~60% of the kept tokens. The newest single month
alone had flooded ~40% of the universe.

The starved era was absurdly cheap: every cut doc from the empty months
summed to ~1% of the budget. This was never a budget-size problem.

## Root cause

s3 scores docs individually — recency+type prior (≤10) plus lexical
(0–8) — and rank admission keeps the top-scored docs until the budget
fills. Old-era captures are thin (a name in the title and `who:`, sparse
body → lexical ≈ 0–1), so decayed prior + weak lexical lands under the cut
line no matter how essential the era is to the question. The failure is
set-level: the user asked for a *window*, and window coverage is a
property of the kept set that no per-doc score can express.

## Rejected designs

- **Raise the budget (the intuitive fix).** Simulated at 500k under rank:
  ~⅔ of the cut mass returns, but a third of the readmissions are more of
  the newest month and the earliest stated month *still* gets zero. Rank
  fill buys depth on the flood before it buys coverage. A sweep budget
  boost stays a parked secondary dial.
- **Proportional per-slice token shares.** Equal or proportional shares
  starve the recent months that genuinely carry more signal; the reserve
  is a representation guarantee, not redistribution.
- **A second scorer for sweep questions.** One scorer with conditional
  admission stays interpretable in the ContextLog; N scorers make every
  logged score ambiguous. Flattening the recency prior for sweeps only is
  the fallback dial if stratification proves insufficient.
- **Trigger on question classification.** The policy switches only on the
  explicit stated-window signal already flowing through `ai:context:date`
  — never inferred, so planning-assist and casual chats cannot trip it.

## What shipped

- `ContextAssembler` gained an opt-in **coverage reserve**
  (`ReserveOptions`): per-slice admission before the rank walk — oldest
  slice first, per-slice doc/token caps, best doc admitted even oversized,
  draws from floored docs (an asked-for era bypasses the relevance floor),
  reserves count against the global budget.
- `ChatContext` arms it when turn 1's producer reports a stated window
  (`ai:context:files` now returns `since`/`until`): month slices over
  [today − since, until ‖ today]. Evolve turns inherit the policy; resume
  re-arms it from recorded stats.
- Observability: stats gain `policy: "sweep-stratified"` and
  `sweep: "since..until"`; reserve-kept docs carry `via: "reserve"`.
  Absent fields = plain rank, exactly as before.
