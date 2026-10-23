---
created: 2026-10-19
updated: 2026-10-23
---

# Slack channel cache

`sky slack:pull` keeps a cache of every message in the owner's unmuted Slack
channels. The cache lives in the state area, never in the
notebook: `state/slack/days/<YYYY-MM-DD>/<channel>.md`, one file per channel
and UTC day, and `state/slack/channels.yaml`, the roster of joined channels
with Sky's cursor into each. The Slack recap (`recap:slack`), the chat tools
and the Connections page read the cache; nothing in it is written into a day
file. The service heartbeat
runs the pull every five minutes, the Beeper cadence (`SLACK_PULL_TICKS` in
`service/run.ts`); a pull by hand is the same command, and the pull's lock
keeps the two apart.

## Why this shape

A day is Sky's partition unit, so the cache is partitioned by day: the UTC
day, a partition that never moves with the machine's zone, the notebook's day
boundary or a day started late. The pull only appends to the current UTC
day's files; a past day is final minutes after UTC midnight, a day's Slack is
a directory listing, and retention is deleting old day directories. The
notebook's day is a view read back from the files (below).
Channels are the unit readers care about (one index line per channel, one
file to open for one channel's day), and a quiet channel costs nothing: no
messages, no file. The files use the saved-conversation layout
(`## Conversation`, an anchor and a `### timestamp - **author**` heading per
message) so the Slack conversation parser reads them, and the anchor ids make
appends idempotent.

## Cursor and windows

The cursor is Sky's own, not Slack's read state: reading Slack never marks
anything read there. A channel's cursor is the newest ts the pull has seen in
it, thread replies included, and it moves only after the files are written.

The joined channels and their newest message come from one `client.counts`
call (`agent-slack channel list --via-counts --counts-only`), which is the
only listing that works on Enterprise Grid and costs one call for hundreds of
channels. Its `latest` moves with new channel messages, not with thread
replies, so a channel is skipped only when nothing is newer than the cursor
and no root sits inside the reply window.

Thread replies are found through the root: `conversations.history` returns
roots with `latest_reply`, and a thread is read (`message list --thread-ts`)
only when that is newer than the cursor. To notice replies to older roots,
every read re-reads the last two days of channel messages, and once a day the
whole backfill window (seven days by default, the first read's depth too).
Replies to roots older than that window are not noticed. A reply is written
on the day it was posted, with a line naming the root's author and time and
linking the root's anchor id.

## Reading a thread back

Most of a busy day is thread replies, and a reply read alone is an answer
without its question. The thread line's link is what makes the whole
conversation recoverable from the cache alone: `readThread` in
`lib/thread.ts` takes the root's id, finds the root's UTC day from the ts
inside it, reads the channel's files from that day on, and returns the root
with every reply in time order, whichever days they fall on. A root older
than the cache is absent; its replies still name it. The Slack recap reads a
day's channels whole and the threads they touch this way
(`recap/lib/slackDay.ts`).

## Three clocks and the day view

Every message carries three clocks. Its heading time is the notebook's: the
day open at that moment, the rule captures file by (`nbfs/notebookTimeAt`:
the last day the owner started at or before the moment, in that day's zone,
hours past 24 once the day ran past midnight; the calendar day when no
started day is in reach). The clock line under the heading,
`*<system time> <zone> · <UTC time> UTC*`, gives the same moment on the
pulling machine's clock and in UTC, and the anchor id holds Slack's own
timestamp. `lib/clock.ts` stamps them, reading each day file once per pull.
The stored notebook time is a snapshot of the day files at pull time; UTC is
the truth, and the view below can be recomputed from it should a start stamp
ever be edited.

`lib/dayView.ts` (`readNotebookDay`) assembles a notebook day from the UTC
files: it reads the UTC days the notebook day can reach (the one before
through the second after) and keeps the messages whose heading carries the
day, by channel, in time order. The Slack recap and the chat tools read days
through it; nothing reads a UTC file as if it were a day.

## Rules, runs and the page

Settings › Connections › Slack is the one place to fine-tune the pull
(ruled 2026-10-16). It reads the roster, the cache and `state/slack/rules.yaml`
through `lib/status.ts` (`describeSlackChannels`): every joined channel,
how many of its messages the cache holds, when its newest one was posted, and
whether it is muted. A mute goes in `rules.yaml`, its own file, because the
pull rewrites the roster from memory while it runs and would lose a change
made to it meanwhile.
The pull combines these choices with Slack's live `users.prefs.get` notification preferences: a mute in either place
excludes the channel, and an unavailable preference read stops the pull rather than enabling muted channels.
The recap checks the same preferences and filters previously cached messages and their earlier threads before building
model input; muting does not delete the existing cache.
The pull skips a muted channel but still moves its
cursor to the channel's newest message, so switching it back on resumes from
now rather than refilling the muted weeks. Each full pull (not one narrowed
by `--channel` or `--max`) is recorded in the roster's `runs`, newest first
and a handful deep, for the page's recent checks; Check now on the page runs
the same command the heartbeat runs.

## Left out

Direct messages and group messages are another tier: they land in the day
directory through [landings](../../land/docs/README.md); the pull reads
channels only. Join, leave, topic and purpose
changes are dropped but still move the cursor. Files are listed by name, not
downloaded. Edits and deletions after a message was cached are not applied.
Bots without a user show as `bot <id>`.
