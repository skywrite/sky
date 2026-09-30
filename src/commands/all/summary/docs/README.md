---
created: 2026-09-27
updated: 2026-09-27
---

# Summaries

`summary:day` writes one file per day, `summary.md`, beside the day file. It is the day compressed once: read the morning after, and read again later by search, by chats about a past day, and by `summary:week`. `summary:week` writes the week's file from the dailies.

## What a daily summary is

Two rules hold every line:

- **Sourced.** Every bullet ends with the file it rests on, `[slack 13:05]`, `[meeting 10:00]`, `[journal]`; every table has a Source column. A line that cannot name its file is not written. The web can turn each tag into a link, and a reader who doubts a line opens the file.
- **Self-contained.** The file is written once and never revised, and days are sometimes ended out of order. Nothing in it may depend on another day: no streak counts, no "waiting since Tuesday", no week totals. Anything that spans days is computed by the app from the files.

The sections, in order: Day at a Glance (one short sentence), Done (Strategic / Operational / Health / Personal, one fact per bullet, decisions led by `Decided:`), Not Done (what the day file left open, stated, never graded), Commitments Made and Waiting On (only promises and asks made that day), Time (meetings, rhythm, allocation, from stated times only), Health (recorded rows, mood in the journal's words), Signals, Insights (what the day taught, Sky's synthesis with sources), Archival (threads filed without taking part), Asset Prices.

A closing **Where Things Stand** section is the day's index: one line per matter the day touched, with its state at day's end. Search lands on that line, and the weekly summary follows a matter across the days it appears in.

## Streaks

The day file's Streaks list carries a running count in each item. The count depends on earlier days, so it never enters the summary. `lib/streaks.ts` reads the list and hands the model one Health row, completion only: `done: morning pages, no sugar; not done: inbox zero`. The prompt forbids streaks anywhere else, including Not Done.

## Pieces

- `day.ts` gathers the day (`lib/gatherDayDocs.ts`), builds the entity background, writes the prompt header (location, prices, health, streaks), calls the model, and writes the file with a `SUMMARY-CONTEXT` record (`lib/contextRecord.ts`) of what the model read.
- `prompts/day.prompt.md` is the contract with the model. `prompts/week.prompt.md` reads the dailies by section name, so a section rename lands in both.
- `--dry-run` prints the prompts without calling the model; `--stdout` prints the summary without writing it.

## Notes

- 2026-09-27 — [The day is self-contained](2026-09-27-the-day-is-self-contained.md): sources on every line, today-only ledgers, Insights in place of Learned, the streak row, the Where Things Stand section.
