---
created: 2026-08-30
updated: 2026-08-30
---

# 2026-08-30 — The meeting check reaches the chat and the voice

`day:meeting:check` only spoke at the day's edges: `day:end` on the ending
day, `day:start` on the day before. Its warning — a calendar meeting with
no notebook record — was a terminal line, seen twice a day and forgotten
in between. Ask Sky in the afternoon whether a meeting was logged
and it had no idea: the calendar is not in the notebook, and the chat
context only holds the notebook.

Now the check runs where Sky's context is assembled, and its result rides
in.

## What moved

The check's substance left the command. `meeting/lib/meetingCheck.ts`
holds it as three parts:

- `compareDayMeetings(day, sources)` — pure. Given the calendar's answer,
  the notebook's meetings, and the day's start-only events, it matches
  records to meetings (start times within 15 minutes) and lists the
  records missing an end time. Tested without a notebook or a calendar.
- `checkDayMeetings(secrets, day, timeDir)` — the reads. Calendar through
  `fetchDayMeetings`, notebook through the service's `meetings` query,
  events from the day's `actions/events/`. In parallel, and never throws:
  a side that fails is reported as unread, with the reason in `errors`.
- `renderMeetingCheck(check, now)` — the check as a model reads it.

The command is now only the terminal rendering of that result. Its output
did not change, except that a calendar fetch that throws now prints the
reason as a `Warning:` line ahead of the skip notice instead of inline.

## What the model sees

One block, the same text in both places:

```
Calendar for 2026-01-27 (Europe/London), checked against the notebook's meeting records as of 2026-01-27 14:05 — 4 meetings: 1 logged, 1 not logged, 1 in progress, 1 upcoming.

- 09:00 - 09:45 (ended 4 hours 20 minutes ago)  Standup  — Jane Doe  — logged (call: Jane Doe)
- 12:00 - 12:30 (ended 1 hour 35 minutes ago)  Atlas sync  — Bob Smith, Ann Lee  — not logged: the notebook has no record of it
- 13:30 - 14:30 (started 35 minutes ago, ends in 25 minutes)  Roadmap review  — Jane Doe  — in progress
- 15:00 - 15:30 (in 55 minutes)  Board prep  — Bob Smith  — upcoming

A notebook meeting starting within 15 minutes of a calendar meeting counts as its record. A meeting that is not logged is one the notebook knows nothing about: say so when it comes up, and never invent what happened in it.
```

The judgment against the clock is the one thing the terminal check never
needed. At the day's edges every meeting is past. In a chat at nine in the
morning, a noon meeting with no record is not unlogged — it has not
happened. So the render takes the notebook clock and calls a meeting
`upcoming` until it starts, `in progress` until it ends, and only then
`not logged`. Extended hours count: a 25:30 clock is 01:30 the next civil
day, and a call that ended at 00:30 is past.

Each absolute time is paired with its distance from the clock — `in 55
minutes`, `started 35 minutes ago, ends in 25 minutes`, `ended 4 hours 20
minutes ago` — so the model has a sense of how far away a meeting is
without doing the arithmetic itself. Whole words, at the scale that
matters: minutes under an hour, hours and minutes under a day, days and
hours beyond; `just now` on the minute. The deltas come from
`PlainDateTime.until`, the same wall-clock difference the rest of the
notebook uses.

An unread side reads as what it is: "The calendar for … could not be
checked … : <reason>", or a list with no logged state and a sentence
saying the notebook could not be queried. Sky then says it could not see
the calendar, rather than answering from nothing.

## Where it lands

- **Chat, terminal and web.** `ai/_lib/gatherContext.ts` — the ambient
  day the session formats into the context segment — gained the rendered
  block; `contextPrompt.ts` places it under `## Calendar`, first after the
  header. Both hosts pass the keychain and the notebook clock; `--when` on
  `ai:chat` checks the chosen day against the real clock, so an old day
  reads as all past.
- **Voice, web and terminal.** `renderVoicePrompts` takes an optional
  `calendar` and the persona prompt renders a `## Today's calendar`
  section with it, telling the voice to answer calendar questions from it
  directly — `ask_notebook` cannot see the calendar. The delegate prompt
  is unchanged. The service runs the check beside its tool discovery when
  a thread opens, so the greeting is not delayed by the whole of it.

The block is a session-start snapshot in every host. A chat that runs
for hours keeps the block it opened with; the `as of` stamp lets the model
weigh it against the newest message stamp, and a per-turn refresh would
change the context segment on every quiet turn and defeat the prompt
cache. The voice session is minutes long and the question does not arise.
