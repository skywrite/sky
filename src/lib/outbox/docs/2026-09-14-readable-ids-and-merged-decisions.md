---
created: 2026-09-14
updated: 2026-09-14
---

# Readable ids and merged decisions

Outbox items were named by a 32-character hash of the conversation key.
The name said nothing about the item.
It also tied one conversation to one file name forever.
Sky now names new items from the notebook-local time and the proposed title.

## The id rule

A new scanner item is named `YYYY-MM-DD_HHMM_Slug`.
Example: `2026-09-12_1705_Approve-the-Atlas-pilot-budget`.
The slug keeps up to six title words and their capitalization.
Punctuation is dropped.
A title without usable characters becomes `Reply`.
A namesake in the same minute gets `-2`, then `-3`.
The id is allocated once, at the moment the record is first written.
Every later write reuses the record's id.
Items created before this change keep their hash ids.
They are never renamed.
Both shapes are valid everywhere an id is accepted: routes, the store, the workers, and the writing-draft source `outbox:<id>`.
`isOutboxItemId` in `itemId.ts` is the single validator.
The scanner finds an existing item by its conversation key, not by hashing the key.
A legacy hash-named file is the last resort.

## The exception

Follow-ups keep deterministic hash ids.
A repeated approval must find the child it already queued.
That is the dedup exception named in AGENTS.md under IDs for User Content.
Workstream communications keep their hash ids for the same reason.

## Merged decisions

A conversation can hold several requests that each need the owner's choice.
The item used to list every per-request question in a row.
Reply options were offered only when exactly one decision remained.
The conversation-level brief now returns `questions` and `replyOptions` when any plan is a decision.
One question per distinct decision, paraphrases merged, at most four.
Two to four labelled options cover those decisions.
Each request keeps its own questions inside its plan.
The brief prompt changed, so completed checks are read again once.

## Participants

A capture without a plain `from` or `to` yielded serialized YAML in the item.
It now yields an empty string.
Source hashes for such captures change once, which flags their items for another look.

## The done list

The status report carries `done` beside the open `items`.
`done` holds items that are archived, reported as sent, or answered in the conversation.
A conversation the scanner set aside on its own, with nothing drafted and nothing asked, stays out of `done`.
It was never the person's to handle.
It is sorted newest first and capped at one hundred.
An answered item that reopened for a new request appears in both lists.

## Severity

A check result carries `severity`.
`warning` means the check completed but some conversations could not be checked.
The message keeps the counts and the retry sentence.
`error` means the check itself failed, or nothing could be checked.
`info` covers the rest, including coverage limits the owner verifies by hand.
