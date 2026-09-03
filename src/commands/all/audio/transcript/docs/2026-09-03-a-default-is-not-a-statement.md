---
created: 2026-09-03
updated: 2026-09-03
---

# A default is not a statement

## What was wrong

The import dialog proposes a When from the file's clock. For a voice memo
that is when the recording was made — after the meeting it recounts. The
import passed that proposal to the door as a stated start whether or not
the person had touched it, and every layer below read "stated" as "the
person said so". The write-up prompt was told the meeting began at the
recording's time and that the speaker said so. The extraction's reading of
the memo's own words — "the meeting ran from 9:00 a.m." — was
replaced by it. The check showed the recording's time under a write-up that
had the meeting's. Then the correction typed at the check was lost at
filing: `meeting:new` kept a stated when over the pipeline's time, and the
stated when was the proposal.

## What changed

- The import sends the When as a stated argument only when the person
  changed it (`startArgs.ts`). Left as proposed, it goes as `--clock`:
  sky's reading of the file, never the person's word.
- `audio:transcript:summary` takes `--clock`, hidden, and gives the prompts
  what it is — `clock.recorded` for a recording, `clock.start` for a
  transcript — so a bare weekday or "this morning" resolves against the
  recording's date, and a meeting time the speaker gives is the meeting's.
  The clock fills the time field only when the words give none
  (`lib/timeField.ts`).
- `meeting:new` takes the pipeline's time whenever it has one. The check's
  answer is the last word; the gate that kept a stated when over it is gone.
- The dialog's note under When says which wins: left as proposed, a time
  the memo says; changed, yours.
