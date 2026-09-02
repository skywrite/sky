---
created: 2026-09-02
updated: 2026-09-02
---

# The transcript pipeline

Design notes for `src/commands/all/audio/transcript/`: the three commands a
recording or a transcript goes through on its way to a meeting, a journal
entry, a note, a message, an event, or a video, and the pieces under `lib/`.
The run record is written up so far. Extend this file as other parts of the
group need a mental model — the glossary's rulings live in the header of
`lib/glossary.ts`, the deterministic correction pass in
`lib/applyCorrections.ts`.

## The three commands

- `audio:transcript:create` — a recording in, the words out. Transcribes
  with the glossary's vocabulary as a guide, streams the text when it goes
  to a file, and writes a `.md` beside the recording with `--save`.
- `audio:transcript:clean` — the words in, the words corrected. Feeds the
  transcript (a Zoom `.vtt`, an `.srt`, a notetaker's `.txt`, or the
  transcriber's output) to an analysis that finds the misheard names and
  terms, puts the unsure ones to the person as one review, remembers the
  rulings in the glossary, and applies every correction as a literal
  find-and-replace. Never an AI rewrite.
- `audio:transcript:summary` — the corrected words in, the write-up out.
  Writes the notes, extracts the fields (title, time, length, medium, who,
  rel, action items), shows them, and takes corrections a line at a time
  until the person is satisfied.

Each composes the one before it: `summary --from-audio` runs `clean`, which
runs `create`. The doors — `meeting:new`, `journal:new`, `notes:new`,
`message:new`, `event:new`, `video:new` — run one of the three and file what
comes back.

## What counts as a transcript file

`lib/ZoomVTT/` reads `.vtt`, `lib/SRT/` reads `.srt`, `lib/plainText.ts`
reads a notetaker's `.txt`. The sniff is on the content, not the name. A
VTT announces itself with a `WEBVTT` header, or by opening on a cue's times:
some live captioners save their transcript that way, with no header, no cue
numbers, whole seconds, and the time of day in place of an offset from zero.
Such a file's length runs from its first cue, not from zero, and that cue
is also when the meeting began, which the web import proposes as the start.
A numbered cue with no header is an SRT.

## Picking up a run

A run of the pipeline costs minutes of model time and, for a recording, a
transcription — and it asks the person questions along the way. When it
stops before it files (a dropped connection, a cancel, the service
restarting under it), running it again must not pay for the same work twice
or ask the same questions twice. So every expensive stage keeps its result,
and a rerun of the same file picks up where the last one stopped.
`lib/transcriptRun.ts`.

- **Keyed by the file's bytes.** The record lives under
  `<user-data>/state/transcript/runs/<sha256>/`. A rename, a move, or the
  same recording dropped on the day twice all find it; an edited or
  re-exported file does not, and rightly starts from nothing.
- **One JSON file per stage**, written when the stage finishes and read
  first when it starts: `raw` (the transcription), `analysis` (what the
  model found), `review` (the person's answers), `writeup`, `extract` (the
  fields — rewritten after every round of corrections, so a rerun shows the
  corrected ones), and `filed` (the document on disk, with the action items
  still to accept). Each carries the notebook time it was kept at.
- **What a rerun skips and what it still asks.** The transcription, the
  analysis and the two write-up calls are skipped when kept. The names
  review is skipped only when a person answered it; a review nobody was
  there for, or one quit early, is asked again. The write-up check is always
  asked, with the kept fields on screen, so nothing is retyped.
- **Filed is filed.** Once `meeting:new` has written the meeting and its day
  item it keeps `filed`; a rerun that finds it does not write a second
  meeting — it says so, offers the action items that were left, and ends.
- **Deleted on completion.** The command that started the run deletes the
  record when it files: the doors, or a transcript command run on its own.
  Nothing outlives a finished run, the raw transcription included. A record
  untouched for thirty days is deleted on open instead of resumed.
- **Starting over.** `--fresh` on any door or transcript command deletes the
  record up front; the import dialog offers the same as *Start over*. A
  parent passes the key down (`run`, hidden) so every command in the
  composition works on one record, and passes `fresh` down so the first
  command to touch the record is the one that clears it.

What a person sees: the terminal prints one line up front — "Picking up the
run from 00:06 at Writing it up. Pass --fresh to start over." — and a gray
line at each stage it reuses. The import dialog says "Picks up where the run
from Today 0:06 stopped, at Checking the write-up" with a *Start over* link;
Start runs the same command, which finds the record on its own.

## Narrative

- `2026-09-02-picking-up-a-run.md` — why the record exists, what it keys
  on, and the cases that shaped it.
- `2026-09-02-a-transcript-without-a-header.md` — the captioner dialect
  the sniff refused, and where a clock-stamped file's length is measured
  from.
