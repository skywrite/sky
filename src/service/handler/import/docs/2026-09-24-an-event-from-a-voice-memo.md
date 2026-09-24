# An event from a voice memo

2026-09-24. The ask: `event:new --from-voice-memo`, and the dialog using it.

## What was there

The dialog already offered Event for a recording.
Its Start ran `event:new --from-audio`.
Only the meeting door called the recording what the dialog calls it:
a voice memo.

## What changed

`event:new` takes `--from-voice-memo`.
The flag's key stays `fromAudio`; `long` names the CLI spelling.
So `--from-audio` still parses, as the alias of the same flag.
Both at once are refused, the way every aliased flag is.
`sky event:new --help` shows `-a, --from-voice-memo`.
Start sends `fromVoiceMemo`, the way it does for a meeting.

## What did not change

The other recording doors still take `--from-audio`:
`journal:new`, `notes:new`, `message:new`.
The pipeline underneath is the same one, `audio:transcript:summary`.
The event door still gets no run key and no clock from the host;
see the meeting case in `startArgs.ts` for what those add.

## Verified

- `sky event:new --help` shows `-a, --from-voice-memo`.
- Unit: the parser maps `--from-voice-memo`, `--from-audio` and the
  host's `fromVoiceMemo` onto one flag, and refuses both spellings at once;
  Start sends `fromVoiceMemo` for an event.
- Browser, on a scratch service and a scratch notebook: a dropped memo
  offered Event, the first minute guessed Event, Start ran the door,
  the write-up check came up, and the event file was filed under the day.
  The day-file line failed in that scratch notebook ("Failed to write
  day item"); the same write succeeds outside the service against the
  same file, and the cause was not chased down.
