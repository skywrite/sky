---
created: 2026-09-02
updated: 2026-09-02
---

# A transcript without a header

## What was wrong

A transcript dropped on the day came back with "is not a WebVTT
transcript" and the offer to keep it as a file. It was a transcript: a few
hundred cues, two speakers, most of an hour of a call. It had been saved by
a live captioner rather than downloaded from Zoom's cloud, and that dialect
skips everything the sniff looked for. No `WEBVTT` line. No cue numbers.
Whole seconds — `09:00:00 --> 09:00:02` — where Zoom writes
`00:00:03.600 --> 00:00:06.240`. And the times are the clock on the wall,
not an offset from the start of a recording.

The sniff asked only for the header, so the web door refused the file
before anything ran. The CLI door never refused it, but not because it read
it: `--from-zoom-vtt` fell through to the plain-text path and handed the
model the raw cues, timestamps and all, with no length. Even with a header
in place the cue pattern would have skipped every cue, because it demanded
a fraction of a second.

Every other transcript the notebook holds has the header, numbered cues,
milliseconds, and a clock that starts at zero. This was the first of its
kind, so nothing had ever measured it.

## What changed

- **The sniff reads the shape, not just the header.** A file that opens on
  a cue's times is a VTT. It cannot be an SRT — SRT numbers every cue — so a
  bare timestamp line as the first line is unambiguous. A numbered,
  headerless file is still the SRT reader's.
- **A cue's times may be whole seconds.** The fraction is optional in both
  positions.
- **The length runs from the first cue when there is no header.** Zoom's
  clock starts at zero with the recording, so the latest cue end is the
  meeting's length, as before. The headerless dialect stamps the time of
  day, and a call from 9:00 to 9:41 is 41 minutes, not 581. `hasHeader` on
  the parsed file carries the distinction. The import's read-back says
  "Transcript" rather than "Zoom transcript" for such a file, and the day's
  proposed start time — the file's clock less its length — lands on the
  call's start instead of the small hours.
- **The turn text keeps the clock.** `[09:00:00] Jane Doe: …` reads as well
  as `[00:00:03]`, and tells the write-up when the call was.
- **The day's proposed start is the transcript's own clock.** The import
  proposed the file's saved time less its length, which is right for a Zoom
  download saved as the call ends. A captioner's file may be saved an hour
  later; its first cue says when the call began, so that is the proposal —
  on the day the file was saved, or the day before when the clock runs later
  than the save. `startOnSavedDay.ts` in the import handler.

The dialect, as the tests have it:

    09:00:00 --> 09:00:02
    Jane Doe: Morning.

    09:00:02 --> 09:00:05
    Alex Chen: Morning. Shall we start?

A `.txt` in this shape is sent to the transcript door the way a headered
one always was: "save it as .vtt" on the web, `use --from-zoom-vtt` in the
terminal.
