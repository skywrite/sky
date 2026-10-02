---
created: 2026-09-27
updated: 2026-09-30
---

# Summaries

`summary:day` writes one file per day, `summary.md`, beside the day file. It is the day compressed once: read the morning after, and read again later by search, by chats about a past day, and by `summary:week`. `summary:week` writes the week's file from the dailies.

## What a daily summary is

Two rules hold every line:

- **Sourced.** The opening story and Meaningful Moments link to original day files using Markdown paths relative to `summary.md`. The input header supplies the summary directory so the model can resolve those paths. Detailed bullets keep their source tags (`[slack 13:05]`, `[meeting 10:00]`, `[journal]`), and source-based tables keep a Source column. Header-derived facts such as location and health measurements need no file link.
- **Self-contained.** The file is written once and never revised, and days are sometimes ended out of order. Nothing in it may depend on another day: no streak counts, no "waiting since Tuesday", no week totals. Anything that spans days is computed by the app from the files.

The opening is for recognizing a day when revisiting it: **Day at a Glance** holds a concrete headline and two or three natural sentences; **Meaningful Moments** holds a few specific moments, each with a short title, one or two sentences, and source links. Event times appear only when known. Quiet days can have fewer moments or none. Decisions, conversations, finished work, and personal experiences earn their place through significance, not activity volume; no invented feelings or obligatory uplifting ending.

The model writes this opening and the detailed record together from the original day files. The saved opening is the content for a day view to render; it needs no second summarization call. Events can appear at both levels without becoming separate accomplishments, and the weekly prompt explicitly reads the full record and deduplicates them.

The detailed sections follow: Done (Strategic / Operational / Health / Personal, one fact per bullet, decisions led by `Decided:`), Not Done (what the day file left open, stated, never graded), Commitments Made and Waiting On (only promises and asks made that day), Time (meetings, rhythm, allocation, from stated times only), Health (recorded rows, mood in the journal's words), Signals, Insights (what the day taught, Sky's synthesis with sources), Archival (threads filed without taking part), Asset Prices.

A closing **Where Things Stand** section is the day's index: one line per matter the day touched, with its state at day's end. Search lands on that line, and the weekly summary follows a matter across the days it appears in.

## Streaks

The day file's Streaks list carries a running count in each item. The count depends on earlier days, so it never enters the summary. `lib/streaks.ts` reads the list and hands the model one Health row, completion only: `done: morning pages, no sugar; not done: inbox zero`. The prompt forbids streaks anywhere else, including Not Done.

## Pieces

- `day.ts` gathers the day (`lib/gatherDayDocs.ts`), builds the entity background, writes the prompt header (location, prices, health, streaks), calls the model, and writes the file with a `SUMMARY-CONTEXT` record (`lib/contextRecord.ts`) of what the model read.
- `prompts/day.prompt.md` is the contract with the model. `prompts/week.prompt.md` reads the dailies by section name, so a section rename lands in both.
- `--dry-run` prints the prompts without calling the model; `--stdout` prints the summary without writing it.

## Notes

- 2026-09-27 — [The day is self-contained](2026-09-27-the-day-is-self-contained.md): sources on every line, today-only ledgers, Insights in place of Learned, the streak row, the Where Things Stand section.
