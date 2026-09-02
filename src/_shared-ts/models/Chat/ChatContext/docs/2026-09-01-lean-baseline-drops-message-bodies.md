---
status: shipped
created: 2026-09-01
updated: 2026-09-01
---

# The lean baseline stops seeding message bodies

All figures rounded; the reviewed chat was a work-reflection question on a
day whose context saturated the 300k budget.

## Symptom

Message captures grew from ~10 a day to ~60 a day over the summer (auto-
captured chat and email pipelines), and the whole-day seeds — today and
yesterday, which the summary baseline exempts — carried every body in.
In the reviewed turn-1 universe:

- Baseline-swept message bodies that **shipped**: ~80 docs, ~19% of the
  saturated budget.
- Message bodies the queries actually asked for: 15 docs, ~2.5%.
- Another ~130 message docs were fetched, parsed, and scored every
  rebuild only to be floored.

## Root cause

Ambient chatter lands exactly in the floor band. A same-day message
scores recency 5 + type 2 = 7; grazing common conversation terms adds
lexical ~1.1–1.3, putting it at 8.1–8.3 against a floor of ~8.05 that
turn. Admission of a couple hundred captures becomes a per-file coin
flip, and on saturated turns the winners displace same-band material the
question wanted (entity cards, AI memories, project overviews were cut
at the same scores). The volume changed ~6× after the baseline was
designed; the policy never re-decided anything — it just kept seeding.

## Change

`seedBaseline` filters `message`-typed docs (by `detectTypeFromPath`,
the same detector the scorer ranks by) out of the whole-day seeds when
the lean baseline is on — finishing the thought `summaryBaseline`
started for older days. `--no-summary-baseline` still seeds every raw
file.

## Why this is safe

Two doors stay open, so nothing becomes unreachable:

- **day.md ledgers every capture** — time, sender, channel, one-line
  subject, link — and day files always seed. Ambient "what came in
  today" survives at one line per message instead of the body.
- **Retrieval fetches bodies deliberately.** A question about a person
  or thread produces a targeted messages query (+10 provenance, which
  outranks anything the ambient sweep could do), evolve turns track
  drift, `read_file` opens anything the ledger names, and `/pin` forces
  a doc in by hand.

That is the intended economics: one-line index ambient, bodies on
demand.

## Rejected alternatives

- **Per-day cap (newest N bodies):** still ships chatter, adds a
  tunable, keeps the parse/score cost of the rest.
- **Demoting the message type score for un-retrieved docs:** leaves the
  floor-band coin flip in place and still fetches and scores every
  body each rebuild.
