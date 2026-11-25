---
created: 2026-11-25
updated: 2026-11-25
---

# Needs response and the response score

`lib/needsResponse` finds the conversations waiting on the owner and scores how fast they get an answer.
Its two screens are the Today card and the `/responses` page.
The routes live in `service/handler/day/needsResponse.ts`.

## The score

- A message that needs a reply is worth 100 points when it arrives.
  It loses 20 at each mark: 1 hour, 4 hours, 12 hours, 1 day, 3 days.
  After 3 days it is worth nothing, and after 7 days with no reply it leaves the list.
  The numbers live in `marks.ts`, which imports nothing so the web client can share them.
- Replying earns whatever the message is worth at that moment.
  A day's score is the sum of what was earned that day.
- There is no daily maximum, on purpose.
  An average capped at 100 came first and was rejected: a day with 30 quick replies has to count for more than a day with 3.
- The score is a running total, never a pass or fail mark.
- A day is the notebook's day: it runs from when that day was started until the next one is started.
  A reply at half past midnight counts for the day still open, which is the day the Today page shows.
  Each entry keeps the `day` it was earned on, so a day's total never moves once the next day begins.

## The clock

- The clock stops between 22:00 and 07:00 local time (`QUIET_HOURS`), but only for the marks shorter than a day.
  The day marks follow the calendar.
  Leaving the night out of every mark would make "1 day" last more than a day and a half on the wall.
- The wait starts at the message Sky first flagged, kept as `waitingSince` on the stored item.
  A follow-up from the sender moves `receivedAt` and the item's `version`, never `waitingSince`.
  Otherwise a nudge two days later would make the message fresh again, and being chased would pay.
- The wait starts over after a reply, or after the owner cleared the message and the sender then wrote again.

## What ends a wait

- A reply Sky sees in the conversation.
  The scanners report every answered stretch as an `AnsweredExchange`, with the reply's own time taken from the
  saved conversation or the email thread.
  The scan's own time would be wrong whenever the app was closed while the reply went out.
- The tick on the Today card (`how: 'responded'`).
  It earns the message's points at the time of the click.
  When Sky later finds the reply itself and it is earlier, the entry moves to the reply's time.
- The X clears the message and earns nothing.
  Undo takes a tick's points back.
- Seven days with no reply are recorded in the last group, worth nothing, unless the owner cleared the message.

## Quick replies that never reach the list

The quickest replies go out before any scan flags the message, so the list never shows them.
They still count: a reply inside 4 hours to a direct message, an email, or an @mention earns by the same marks.
That is limited to once per conversation a day, or a long back-and-forth would earn on every turn.
Listed messages are not limited this way, because they are the ones the owner was shown.

A slow reply to a message that was never flagged earns nothing: nothing says that message needed an answer.
The usual case is a trailing "thanks", followed three days later by the owner starting a new topic.

## Where it is kept

- `state/needs-response/state.json` is the list itself, rebuilt on every scan.
- `state/needs-response/earned.json` is the record of finished waits: one entry per wait, kept for 60 days.
  It is a separate file so that a version of Sky without the score leaves it alone.
- Both live in the state directory, never in the notebook.

## Notes

- 2026-11-25: the Gmail scan reads a thread once more when it leaves the inbox.
  Reply-and-archive is the usual way to answer an email, and the inbox listing alone never shows that reply.
