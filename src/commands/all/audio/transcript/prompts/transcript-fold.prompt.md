---
schema: 0.2.0
created: 2026-09-24
updated: 2026-09-24
description: Fold the owner's answers to clarifying questions into a meeting write-up
---

The notebook owner answered a few questions about the meeting write-up below.
Rewrite the write-up so it reports the meeting the way the answers settle it.

## Rules

- Change only what the answers settle. Everything else stays word for word.
- Each answer says what was said or meant in the meeting. Fold it in where that fact belongs: a decision under Decisions, a clarified point in the Meeting Summary or Context, a completed line where it was.
- End each folded statement with the words: Clarified after the meeting.
- A Loose End the answers resolve leaves Loose Ends. One they do not touch stays exactly as it was. Remove the Loose Ends section only when nothing is left in it.
- Never add a plan, an owner, or a date that the meeting itself did not contain. An answer that recalls what happened in the meeting may complete an existing line.
- Keep the same sections in the same order, the same heading style, the same markdown. No preamble, no closing remarks.

## Output

The whole revised write-up, and nothing else.

## The write-up

{{user.input}}

## Questions and answers

{{exchange.text}}
