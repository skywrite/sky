---
created: 2026-09-02
updated: 2026-09-02
---

# The stated time carries through

## What was wrong

The import dialog proposed the meeting's start from the transcript's own
clock, matched it to the calendar, and passed it to `meeting:new` as a
stated `when`. The filing step honoured it. Nothing between did.
`meeting:new` ran the summary without it, so the write-up's Time/Date
section read something like "9:00–9:41 (approx. 41 minutes); date not
stated", and the extraction, asked for `YYYY-MM-DD HH:MM` with no date to
give, returned nothing. The check showed **time (not detected)** under a
write-up that plainly knew the time. The answer given at the start was
lost by the end.

## What changed

- `audio:transcript:summary` takes `--when`, hidden: the start as the
  caller states it, in notebook time.
- The write-up and extraction prompts get it as `stated.when`. The
  Time/Date section states the date and time, and relative dates in action
  items resolve against it. The message-template prompts carry the same
  line for a conversation.
- The stated start is the time field. It replaces the extraction's
  reading, and fills a kept record that has none. A time corrected at an
  earlier check stays, and a correction typed now still wins.
- Every door that runs the summary passes it when the caller stated one:
  meeting, notes, message, event, video.
