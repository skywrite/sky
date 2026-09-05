---
created: 2026-09-05
updated: 2026-09-05
---

# 2026-09-05 — A video from its transcript

An `.srt` dropped on the day got "Sky cannot take this file. Sky doesn't
take .srt files." The terminal had taken one for months: `video:new
--from-srt` cleans the transcript, writes the video up, and files it under
the day with the transcript in the body. The web had no door for it, and
the read-back knew the format well enough to refuse it by name — "an SRT
file, which sky does not take yet" — without offering the door that did.

## What was wrong

- `readback.ts` mapped `.vtt` to the transcript door and `.srt` to nothing.
  The SRT parser (`commands/all/audio/transcript/lib/SRT`) was already the
  pipeline's second dialect; only the import never called it.
- `video:new` asked its one question — which platform — through clack,
  guarded by a terminal check, so run inside the service it silently filed
  every video as "Video". It reported no steps, so the page would have shown
  "Working" and nothing else. And it kept its own run record by hashing the
  file, so a host that keyed the upload and let the file move could not hand
  the record down, and *Pick up where it stopped* would have found nothing.

## What the fix is

- A fifth source, `srt`, and a sixth kind, `video`. The read-back parses the
  file the way it parses a `.vtt` — "Transcript · 12 minutes · 3 turns", the
  speakers when the cues label them — and offers one kind. An SRT body under
  the wrong extension, or a WebVTT body in an `.srt`, is sent to its own
  door in a sentence, the way a `.txt` holding WebVTT already was. The cues
  count from the start of the recording, so the When is proposed from the
  file's time and length, and the calendar is not consulted: a video is not
  a meeting.
- The start runs `video:new --from-srt <staged file>` with the same three
  host arguments the meeting door takes: the run record's key, the proposed
  When as the file's clock, or a changed When as a stated one.
- `video:new` asks through `context.prompt` — clack on the terminal, a
  select on the page; unattended, it files as "Video" as before — plans
  Checking names · Writing it up · Filing, opens the record a host passed
  down (or the file's own) and says what it picks up at, and returns the
  absolute path of what it filed, since the pipeline may settle a day the
  dialog did not propose. The terminal still opens the file; the service
  does not.
- The recording kinds are now their own list: a voice memo's first minute
  is still classified among the five doors that take audio, never as a
  video.

## What was left

- `meeting:new` has no `--from-srt`. An `.srt` of a recorded meeting is
  offered as a video only; the meeting door for it is the next rung, and
  a small one — the summary pipeline already takes the flag.
- The read-back cannot tell a clock-stamped `.srt` from one counting from
  zero, and assumes the latter. A headerless `.vtt` is read as clock time.
