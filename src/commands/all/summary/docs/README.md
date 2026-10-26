---
created: 2026-09-27
updated: 2026-10-26
---

# Summaries

`summary:day` writes one file per day, `summary.md`, beside the day file. It is the day compressed once: read the morning after, and read again later by search, by chats about a past day, and by `summary:week`. `summary:week` writes the week's file from the dailies.

## What a daily summary is

Two rules hold every line:

- **Sourced.** The opening story and Meaningful Moments link to original day files using Markdown paths relative to `summary.md`. The input header supplies the summary directory so the model can resolve those paths. Detailed bullets keep their source tags (`[slack 13:05]`, `[meeting 10:00]`, `[journal]`), and source-based tables keep a Source column. Header-derived facts such as location and health measurements need no file link.
- **Self-contained.** The file is written once and never revised, and days can be summarized out of order.
  Activity claims concern this day only: no streak counts, no "waiting since Tuesday", no week totals.
  A conversation's source can identify its earlier start and filing date without treating earlier messages as today's work.

The opening is for recognizing a day when revisiting it: **Day at a Glance** holds a concrete headline and two or three natural sentences; **Meaningful Moments** holds a few specific moments, each with a short title, one or two sentences, and source links. Event times appear only when known. Quiet days can have fewer moments or none. Decisions, conversations, finished work, and personal experiences earn their place through significance, not activity volume; no invented feelings or obligatory uplifting ending.

The model writes this opening and the detailed record together from the original day files. The saved opening is the content for a day view to render; it needs no second summarization call. Events can appear at both levels without becoming separate accomplishments, and the weekly prompt explicitly reads the full record and deduplicates them.

The detailed sections follow: Done (Strategic / Operational / Health / Personal, one fact per bullet, decisions led by `Decided:`), Not Done (what the day file left open, stated, never graded), Commitments Made and Waiting On (only promises and asks made that day), Time (meetings, rhythm, allocation, from stated times only), Health (recorded rows, mood in the journal's words), Signals, Insights (what the day taught, Sky's synthesis with sources), Archival (threads filed without taking part), Asset Prices.

A closing **Where Things Stand** section is the day's index: one line per matter the day touched, with its state at day's end. Search lands on that line, and the weekly summary follows a matter across the days it appears in.

## The Slack recap

Slack channels reach the summary through the Slack recap, `actions/recaps/<time>_slack.md`, which `recap:slack` writes from the channel cache with Opus 5.5 at high effort ([recap notes](../../recap/docs/README.md)): every channel the owner is a member of, digested into a Channels block, What moved, Asked of you and Where things stand, each line tagged with its channel and time. The service writes it once the next day has started; `summary:day` writes it first when a day with channel messages has none, and `--dry-run` only says so. To the prompt the recap is the room the owner was in: a line in it is filed material unless it starts with `You:`, its Channels block becomes the summary's `## Channels` section, and the matters go to Where Things Stand. The raw channel files never reach the summary.

The reading budget is 750k of the model's tokens, fitted to the profile's window. The text is measured at four characters a token and restated through the model's learned ratio (`_shared-ts/ai/tokenRatio.ts`); over budget, the command refuses rather than trims.

## Conversations

Whole chat files are excluded from both the day's documents and entity background.
`lib/chatActivity.ts` formats only the day's messages from saved transcripts and permanent live chats, then appends a
deterministic **Conversations active this day** source section to the saved summary.
The [cross-day contract](../../../../service/handler/chat/docs/README.md#conversations-across-days) owns transcript location,
temporary-chat exclusion, and links that survive Save & close.

## Streaks

The day file's Streaks list carries a running count in each item. The count depends on earlier days, so it never enters the summary. `lib/streaks.ts` reads the list and hands the model one Health row, completion only: `done: morning pages, no sugar; not done: inbox zero`. The prompt forbids streaks anywhere else, including Not Done.

## Pieces

- `day.ts` gathers the day (`lib/gatherDayDocs.ts`), writing the Slack recap first when it is missing (`recap:slack`), builds the entity background, writes the prompt header (location, prices, health, streaks), calls the model, and writes the file with a `SUMMARY-CONTEXT` record (`lib/contextRecord.ts`) of what the model read.
- `prompts/day.prompt.md` is the contract with the model. `prompts/week.prompt.md` reads the dailies by section name, so a section rename lands in both.
- `--dry-run` prints the prompts without calling the model; `--stdout` prints the summary without writing it.

## Notes

- 2026-09-27 — [The day is self-contained](2026-09-27-the-day-is-self-contained.md): sources on every line, today-only ledgers, Insights in place of Learned, the streak row, the Where Things Stand section.
