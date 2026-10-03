---
created: 2026-10-03
updated: 2026-10-03
---

# Days start and close by themselves

## The problem

A day in the notebook runs from the moment the person starts it until they
start the next one, past midnight when they stay up. That is the right
model for filing: a note at 00:40 belongs to the day still being lived. But
the model is spoken through two manual acts, `day:start` and `day:end`, and
for anyone who has not learned them the acts are strange. A new person who
never presses Start keeps a calendar notebook. One who presses it once is
stuck on that day until they find Start again. A day never pressed End
collects an amber "not ended" that never clears.

Starting and ending are the notebook's way of asking two questions it could
mostly answer for itself: have you slept, and is this day's record done.

The buttons moved onto the day pages on 2026-10-03 (see the day handler's
docs). That makes the acts findable. This note is the direction past them,
agreed on 2026-10-03 and parked: not yet.

## The shape of the fix

Three rungs, each its own decision.

**The day starts on your first act.** Once the calendar has moved past the
open day and the person has been away for hours — no web requests, no
commands, no notebook file changes — the first thing they do runs
`day:start` for the calendar's day, exactly as a press would, and the page
says so quietly ("Started Friday at 7:05"). A short gap after midnight
starts nothing: the open day keeps everything, and the add form asks which
day a to-do is for ("Thursday or Friday?") instead of guessing. "Hours
away" is a default, six to begin with, that the person can change. The
start time still gets written, from the first act, so day lengths and
summary windows keep their anchor.

**A day closes itself.** The previous day stays open after the next one
starts; the person's tidying — meeting notes, imports — usually comes
after. The day's page lists what stands between it and its end: records
with no end time, calendar meetings with no notes, messages saved but not
imported, tasks still open. Each row is done or dismissed. When the list is
empty, `day:end` runs; a day left untouched for a few days closes anyway.
"Close Thursday" stays for closing early. Unfinished tasks go to Incomplete,
the perfect-day mark lands and the summary gets written, as End does today.

**The words.** While the notebook's day and the calendar's disagree, the
sidebar names the days instead of saying Today and Tomorrow ("Thursday ·
still open", "Friday · not started"). A day waiting to be closed reads "not
closed" rather than "not ended": the day ended when the next one began.

The terminal's `day:start` and `day:end` keep working as they are.

## What it trades

Inference, and a wrong guess cannot be undone, because files never move
between days. An evening out followed by one note at 00:30 looks like a
morning. That is why nothing starts without either a long absence or the
person's answer, and why the threshold is a setting rather than a rule.
Automatic closing has to leave a closed day editable, or a sweep would
strike tasks the person still meant to tick. And the morning press is a
ritual for some; where it is missed, the button stays as an option on the
same page.

## Rulings so far

- 2026-10-02: starting a day must not end the previous one. Tidying comes
  first.
- 2026-10-03: for people new to Sky, starting and ending a day by hand is
  weird; days that start and close by themselves is the direction.
- 2026-10-03: not yet. The buttons first.
