---
created: 2026-09-03
updated: 2026-09-03
---

# The day gets a rail

A document in the explorer has a Details rail: what is about it rather
than part of it. The day had nothing of the kind. Around its record sat a
Files panel that opened from a header button, a Running block that mixed
chat threads with import jobs, and a Filed card that listed the day's
saved chats beside archived conversations. The sidebar's Threads list
carried the import jobs too, and since a job is written to disk and never
forgotten, every finished import from any day stayed there.

The day now has the same rail a document has, drawn with the same
sections and the same drop pad, and the things that were about the day
moved into it.

## What is in it

**Schedule** is new. The calendar's meetings for the day, in start order,
from the same read the meeting check makes for chat and voice. A past
meeting says whether the notebook filed a record of it — `filed`, a link
to the record, or `no record` — using the check's own rule: a notebook
meeting starting within fifteen minutes of the calendar's start counts. The
meeting under way is tinted and carries `join` when the event has a
conference link. A coming meeting shows its length. The rail re-reads the
schedule every minute so the tint moves with the clock. A calendar that
does not answer reads as "Calendar not read", never as an empty day.

**Chats** are the day's: the ones filed under it, each with its time and
turn count, and on today the live threads too, marked with a dot. This is
where the saved-chats half of the Filed card went.

**Working** shows import jobs only while they are in hand — running,
waiting for the person, or stopped where a start could pick them up — with
Review or Open. A filed import is on the day already, as the meeting it
made, so it leaves the rail; a file sky refused was never work, so it never
shows.
Import rows left the sidebar's Threads list at the same time; a thread is
a conversation.

**File Attachments** sits anchored at the foot: a drop pad with "choose
files…", and nothing else. A file dropped or chosen here is kept with the
day the way the old panel kept it — the original moves in when this Mac
has it, a copy lands otherwise, and the toast holds Undo. The pad lists
nothing; the day's directory is the explorer's to show.

## What changed around it

The header keeps Day file and gains the Details toggle a document has.
Below 1180px the rail is an overlay from that button, closed by Escape or
by turning the page, exactly as in the explorer — both pages now share the
one rail hook. The Files panel, its header button and its count are gone,
and so is the Running block; the plan cards and the day-so-far record are
where they were.

## Routes

`GET /day/:ymd/schedule` answers the rail. It is a separate read from the
day view because it goes to Google and can be slow or fail; the day view
stays a local read.

## Verified

- 2026-09-03 — the schedule: three meetings and a clock inside the second
  read past, now, next; another day reads wholly past or wholly ahead; a
  record seven minutes after a start links, one an hour off does not; the
  row carries the others without the owner and the join link; a calendar
  that did not answer reads as not read with its reasons; the route
  answers a day and refuses a word (schedule test).
