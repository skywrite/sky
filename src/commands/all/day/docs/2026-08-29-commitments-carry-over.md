---
created: 2026-08-29
updated: 2026-08-29
---

# Commitments carry-over

## What was missing

A commitment that did not happen had nowhere to go. `day:todo:move-next`
carries unfinished todos to tomorrow; `day:reminders:move-next` does it for
reminders. A missed `15:00 > Call Acme` stayed unstruck on the old day. It kept
`perfect` false, and tomorrow's plan never saw it unless it was retyped by hand.

## What was considered and rejected

- **A list-kind flag on `day:todo:*`.** `day:end` runs `day:todo:incomplete`
  by default, and users have it in `commands.day.end`. Reshaping that
  command's flags for a second list family risks the default sweep for a
  naming convenience. Rejected.
- **One shared move helper for todos, commitments, and reminders.** The three
  already disagree on the details: reminders create the target list and move
  link definitions by hand; todos require the target list and append unsorted;
  commitments must sort. A helper would either change todo behavior or carry
  a switch per family. Rejected. The commitments logic is its own small pure
  module instead, and the README records the differences.

## Why the shape holds

The commitments sweep mirrors the todo sweep so the two can run back to back
at day's end. That is also why it appends to an existing `Incomplete` section
rather than adding one: by the time it runs, `day:todo:incomplete` has usually
created `Professional Incomplete` already.

The move checks the target file before sweeping the source. The todo move does
this the other way round, which on a missing target leaves the items swept
into `Incomplete` with nothing moved. Not changed there in this pass; noted
so it is not copied again.
