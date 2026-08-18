---
created: 2026-08-15
updated: 2026-08-15
---

# ai:context — how a question becomes a bounded notebook query

Each stage is its own command, composable from the CLI:

1. **`ai:context:date`** (`date.ts`, fast model) — extracts a lookback
   duration (`since`), a stated end (`until`), and any explicit `dates`
   from the message, then enforces the coverage invariant below in code.
2. **`ai:context:sel`** (`sel.ts`, balanced model) — writes GraphQL against
   the DomainCollection schema. A stated `since` becomes `recent:` on every
   dated root with `limit` omitted (the period is the bound); a stated end
   switches to a `dateGte`/`dateLte` pair instead — `recent:` always closes
   at now and would silently re-open a closed range.
3. **`ai:context:files`** (`files.ts`) — orchestrates 1→2, executes via
   `markdown:sel`, returns paths. `ai:chat`'s first turn rides this
   (`ChatContext.firstTurn`); `ai:context:gather` composes the same stages
   into loaded context.

Query *execution* mechanics — filter predicates, duration parsing, default
caps — live in `#shared/models/DomainCollection/query/`. What ai:chat
*keeps* of a gathered universe (admission policy, pruning, the sweep
reserve) lives in `#shared/models/Chat/ChatContext/docs/`. This doc owns
the composition: how language turns into query bounds.

Query-behavior changes are recorded here as dated entries — symptom,
rejected designs, rationale — so extraction-prompt tuning and future evals
have a corpus of real failure shapes to draw from.

## The timeframe contract

- **The window is a floor derived from language, enforced by code.** The
  extraction model reliably pulls dates out of a message but routinely
  botches the calendar arithmetic that turns "since March 1 of 2025" into a
  duration — it rounds to a familiar bucket that lands short. `date.ts`
  therefore re-derives coverage deterministically: the window
  [from ‖ today − since, until ‖ today] is widened at the start and
  extended at the end until it contains every stated past date
  (`lib/widenSince.ts`). In range mode the resolution also carries an exact
  `start` — the stated `from` when the user named one, else derived from
  the duration — so an over-generous duration guess cannot bleed the range
  start earlier than the user said.
  See [start coverage](2026-08-15-window-must-cover-stated-dates.md) and
  [stated ends](2026-08-15-stated-range-ends.md).
- **Stated dates are a floor, never a ceiling.** "My conversation with Jane
  on Friday" mentions Friday but does not mean "look back one day" — the
  guard only ever widens a window, never narrows one to fit the dates. The
  end bound exists only when the user *states* one; two point-dates are not
  a range.
- **No stated timeframe ⇒ all history.** Results are newest-first and
  capped, so an unbounded search is cheap and reaches sparse old topics
  (`files.ts`). An unparseable duration also drops to all-history rather
  than throwing mid-query.
- **User-stated sweeps are never volume-limited.** A `recent:`-bounded root
  carries no `limit` — downstream budgeting prunes any excess (8dfbd07). A
  `limit` beside the bound would silently keep only the newest slice of the
  window.
- Every guard intervention is visible in the gather transcript
  (`widened: 1y → 533d (covers stated 2025-03-01)`), and an explicit
  `--since` on `ai:context:files` bypasses extraction and guard entirely.

## Absolute date bounds

One-ended bounds work on their own: a lone `dateGte` filters from that date
to now and is exempt from the default cap — it closes at now, exactly like
`recent:` — while a lone `dateLte` filters everything up to its date but
stays capped, being genuinely open toward the corpus start. Until
2026-08-15 a lone bound validated against the schema yet filtered
*nothing* (the resolvers applied the pair only), and evolve-turn queries
write lone `dateGte` naturally, so the defect fired in live chats. The
since-hint still speaks `recent:` durations; absolute bounds are simply no
longer a trap when the model reaches for them.
