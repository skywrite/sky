---
created: 2026-09-26
updated: 2026-09-26
---

# A follow reads its last activity in its day's zone

## The problem

After a trip, a followed thread saved the same message again on every sync.
Each sync appended one more copy to the day's file and ran the AI conversion again.

A follow's `lastActivity` is the newest message's time as the notebook writes it:
the wall clock of that day, in the day's `tz:`.
The sync counts a message as saved when it is older than that cutoff.
The listing read the cutoff in the Mac's current zone instead of the day's.
While the Mac was in the same zone as the day, the two agreed.
Once they differed, the cutoff moved by the difference:

- A day kept west of the Mac put the cutoff before the message that set it.
  That message looked new on every sync and was appended again.
- A day kept east of the Mac put the cutoff after it.
  A reply arriving inside the gap counted as saved and was never captured.

## What changed

- `convertFromNotebookTimezone` in `_shared-ts/nbfs` is the inverse of `convertToNotebookTimezone`.
  It reads a notebook time in the zone of its own day and returns the instant.
  Extended and negative hours (`25:30`, `-2:30`) read the way the writer meant them.
- Both follow listings read `lastActivity` through it:
  the Gmail one here, and the IMAP one in `email/lib/getInboxThreads.ts`.

## What it does not change

- Follow files are not rewritten.
  They were always written in their day's zone, so they read right from the next sync.
- Copies already appended stay in their files until someone removes them.

## Verified

- `convertFromNotebookTimezone_test.ts` covers a time on a day kept in Honolulu,
  extended hours on a day kept in Tokyo,
  and round trips through `convertToNotebookTimezone` on either side of midnight.
- `getInboxThreads_test.ts` covers a follow last active on a day kept in Honolulu and one kept in Tokyo.
  In both, the message that set the cutoff counts as saved and a reply half an hour later counts as new.
  Against the previous listing, on a Mac in Chicago,
  the Honolulu case found both messages new and the Tokyo case found both saved.
- No test wrote to a real notebook or follow directory.
