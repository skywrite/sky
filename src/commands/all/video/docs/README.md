---
created: 2026-09-25
updated: 2026-11-08
---

# Video commands

Design notes for `src/commands/all/video/`.

## video:new

Two paths. A summary with `--from`, `--to` and `--medium` writes a
placeholder file for the editor to fill. `--from-srt`, or `--from-zoom-vtt`
for a Zoom Clip's `.vtt`, runs the transcript pipeline
(`audio:transcript:summary` with the `audio-message` template: a
recording is one-way, from/to rather than a shared attendee list), files
the transcript under the day's attachments, and writes the summary with the
cleaned transcript under it. The import page's .srt and .vtt doors call this
command with the staged file, the run key it issued at upload, and the
file's clock.

Run records (`audio/transcript/lib/transcriptRun.ts`) let a second run
pick up what the first already paid for; `--fresh` forgets them.

## Source URL imports

With `--url`, the command creates or completes a recording through `lib/importVideo.ts`.
`--video-file` supplies the recording and `--from-srt`, `--from-zoom-vtt`, or `--from-text` supplies its transcript.
`--when` states the recording time for a new entry; optional `--recorded-at` retains the original zoned instant in metadata.
Both import paths name notes with the medium, available speaker or recipient, and short summary, such as
`Loom_Jane-Doe_API-Review.md`.
Media and transcript attachments retain a day prefix, such as `2031-04-05_Loom_Jane-Doe_API-Review.mp4`.
The day folder and metadata retain recording time; a numeric suffix handles note-name collisions.
`--dry-run` reads matches and source-file presence without model calls, checkpoints, attachments, or notebook writes.

Loom identity comes from the ID in source metadata, normalized across share/embed URLs and query strings.
The importer also reads legacy `video.loom.url`, scalar `video`, and top-level Loom `url` headers.
Verified alternate URLs in `video.aliases` identify the same recording without replacing its original URL.
An ordinary Loom link in a message or day note does not identify a recording entry.
Multiple matches require destination review.
An existing entry retains its path, date, metadata, attachment annotations, authored notes, and existing transcript text.
Only missing video, substantive summary, and full transcript are added.
Legacy `who`, `from`, and `to` fields can contain an unquoted channel such as `#atlas-updates`.
Video parsing quotes these channel literals before YAML reads them as comments and turns their values into null.
Preservation checks must retain the channel text, rather than accepting matching null values before and after a write.
New summaries appear before an existing transcript, replacing empty template sections where available.
The short YAML `summary:` title does not establish that a summary exists in the body.
Sources are copied during filing, preserving caller-owned originals.

Legacy URL lists and `video: [{url: ...}, ...]` notes represent collections.
They remain indexes; each recording gets its own entry, summary and transcript.
A collection item's optional `file` associates that source with an existing video attachment so the correct media can be
reused through the normal attachment filing path.
Conflicting file associations require review.
Filing appends a local recording link to the original index without replacing its metadata or body.
The pending record repairs both the day link and collection links after an interruption.

A source lock serializes CLI and web imports of the same URL.
AI runs before the short document write lock; filing re-reads the document so concurrent edits survive.
A local pending record repairs an interrupted new entry's day link, while the notebook's URL remains the duplicate key.
Successful existing-entry updates never add another day item.

`--accept-all-reviews` explicitly accepts offered name/term corrections and generated write-ups for the selected run.
An issue without a suggested correction stays as heard.
The review answers use the normal pipeline checkpoints and glossary behavior.
The web carries this choice across one file selection and saves it on each started job for retry; separate selections
start with review enabled.

## Tags and rel

The `--from-srt` path fills `tags:` and `rel:` from the archived videos:
the `video` corpus medium in `lib/notebook/enrich/corpus.ts`, fed by the
service's `videos` query, through the same auto-tag and auto-rel stack
every other capture uses. The pipeline's own rel (people discussed,
resolved against corrections and the glossary) comes first; auto-rel
appends graph-validated refs it missed. `--no-auto-tag` and
`--no-auto-rel` skip either half. The page shows the step as "Adding tags
and links".

**The speaker is the conversation.** The enrichment stack keys its history
prior on one identity per record: the Slack channel, the email
counterparty, a meeting's `who:`, a recap's `app:`. A video keys on
`from:`, the speaker, falling back to `to:`. A colleague's weekly update
tends to file the way their last one did. The command passes the speaker
as the classifiers' `conversation` input, so `to:` and `from:` still reach
the prompts as the parties.

The manual path is not enriched. A title and a placeholder body give the
classifiers nothing to read; `notes:new` makes the same call.

## Notes

- 2026-09-25: [Videos tag and rel themselves](2026-09-25-videos-tag-and-rel-themselves.md).
