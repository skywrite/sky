---
created: 2026-09-02
updated: 2026-09-05
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

## What the caller states wins; what sky reads only fills

A start the person stated — `--when` typed on the command line, or the
When row of the import dialog changed by hand — reaches the summary as
`--when`. The write-up's Time/Date section says it, the extraction takes it
as the time and resolves "Friday" against it, and the check shows it in the
time field. Only a correction typed at the check replaces it.

A start sky read off the file — the dialog's proposal, left as it was — is
not a statement, and reaches the summary as `--clock`. The prompts get it
as the fact it is: when a recording was made, or when a transcript's clock
says the meeting began. A memo's clock is when the notes were dictated,
after the meeting they recount, so a time the speaker gives is the
meeting's, and the clock only anchors the date ("Wednesday", "this
morning"). The clock fills the time field when the words give none, and
replaces nothing. `lib/timeField.ts` holds the rule.

Whatever the pipeline returns as the time is the door's last word at
filing: the stated start folded in, then whatever the check settled on. No
door keeps a dialog value over it.

## What counts as a transcript file

`lib/ZoomVTT/` reads `.vtt`, `lib/SRT/` reads `.srt`, `lib/plainText.ts`
reads a notetaker's `.txt`. The sniff is on the content, not the name. A
VTT announces itself with a `WEBVTT` header, or by opening on a cue's times:
some live captioners save their transcript that way, with no header, no cue
numbers, whole seconds, and the time of day in place of an offset from zero.
Such a file's length runs from its first cue, not from zero, and that cue
is also when the meeting began, which the web import proposes as the start.
A numbered cue with no header is an SRT.

## A name matched is a name corrected

The analysis returns the people — who was there, who was discussed, each
matched to a contact — and, separately, the issues to fix in the text. The
two used to be independent: the model could match a misheard first name to
its contact for the rel list and raise no issue for the spelling, and the
transcript kept the mishearing, on into the write-up, whose prompt trusts
the transcript's names. Now every person carries the spellings the
transcript got wrong for them, and `lib/misheardNames.ts` turns each into a
high-confidence correction the replacer applies with the rest: a one-word
mishearing lands on the one token of the contact's name it stands for, a
longer one on the full name. The match is the evidence; the correction
follows from it in code.

A high-confidence name fix that lands on a contact — the full name or one
token of it, `lib/contactNames.ts` — enters the glossary as a confirmed
correction, so it replays without being re-derived and its right side
guides the transcriber next time. Other auto-fixes are applied once and
forgotten, as before: a wrong fix cemented is a wrong fix forever.

Not covered: a person matched for who/rel whose name never appears in the
transcript in any spelling the model listed. That needs a review question
of a new shape ("which word is this person?") and is not built.

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

- `2026-09-05-a-match-owes-the-text-a-correction.md` — the rel list named
  the right contact while the write-up kept the transcriber's misspelling;
  why the two outputs diverged, and what now ties them.
- `2026-09-02-picking-up-a-run.md` — why the record exists, what it keys
  on, and the cases that shaped it.
- `2026-09-02-a-transcript-without-a-header.md` — the captioner dialect
  the sniff refused, and where a clock-stamped file's length is measured
  from.
- `2026-09-02-the-stated-time-carries-through.md` — the start chosen in
  the dialog reached the filing step but not the write-up or its check.
- `2026-09-03-a-default-is-not-a-statement.md` — the dialog's untouched
  proposal was passed as a stated start: it beat the memo's own words at
  the check and the person's correction at filing.
