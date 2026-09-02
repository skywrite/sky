---
created: 2026-09-02
updated: 2026-09-02
---

# Picking up a run

## What was wrong

A run of the transcript pipeline is expensive in two currencies. It spends
minutes on model calls — a transcription of the recording, an analysis of
the whole transcript by the strongest model, the write-up, the field
extraction — and it spends the person's attention on questions: which
spelling, whether the fields are right, which action items to accept.

None of it was kept. The transcriber wrote the raw transcript beside the
recording and then ignored it on the next run. The cleaner and the
summarizer dumped their outputs to /tmp as insurance, but nothing ever read
them back. So a run that stopped — a socket closed mid-analysis, a cancel,
the service restarting under a running import — cost the whole thing again,
questions included. The web import's *Start again* ran the command from the
top. The only recovery was by hand.

## What changed

Every expensive stage now keeps its result in a run record, and a rerun of
the same file reads the record before doing any work.

**The key is the file's bytes.** A record is a directory named by the
sha256 of the source file, under the state directory next to the glossary.
That choice settled three cases at once: a recording renamed or moved
between runs still finds its record; the same memo dropped on the day twice
is one run, not two; and an edited or re-exported transcript is a different
file and starts from nothing.

**One file per stage.** The transcription, the analysis, the review
answers, the write-up, the fields, and the filed document each land as one
JSON file the moment they exist, each stamped with the notebook time.
Writes go through a temporary name and a rename, so a crash mid-write
leaves nothing half-kept. The stage files are hand-readable, like the
glossary.

**The key travels.** A door that knows the file hashes it once and passes
the key down through the composition as a hidden argument, so the
transcriber, the cleaner, and the summarizer work on one record. When the
file is found on the Desktop instead, the first command to see it keys the
record and returns the key up.

**Only a person's answers are kept.** The names review is skipped on a
rerun only when someone answered it. A headless run has no reviewer, and a
review the person quit is not a review done — both are asked again. The
write-up check is asked every time, with the kept fields on screen, so a
correction typed once is not typed twice.

**Filed is filed.** `meeting:new` keeps a `filed` stage after writing the
meeting and its day item. A rerun that finds it does not write a second
meeting: it says the meeting is filed, offers the action items that were
still to accept, and ends. The web import keys the file at upload for this
case — by the time a filed run stops, the upload has been moved into the
day's attachments and can no longer be hashed.

**Nothing outlives a finished run.** The command that started the run
deletes the record when it files. The raw transcription goes with it; a
meeting deliberately redone is rare enough to transcribe again, and one
rule is simpler than two. A record untouched for thirty days is deleted on
open.

**Starting over is a flag.** `--fresh` clears the record before anything
reads it, and is passed down so the first command to touch the record
clears it. The import dialog offers the same as *Start over*.

## What it does not do

It does not prevent the failure it was built for. One ten-minute streamed
analysis of a ninety-minute transcript is still one call, and a drop
mid-stream still loses that call — the record only makes the retry cheap.
Analyzing in windows, each one kept, is its own piece of work.
