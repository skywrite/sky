---
created: 2026-09-25
updated: 2026-09-25
---

# Video commands

Design notes for `src/commands/all/video/`.

## video:new

Two paths. A summary with `--from`, `--to` and `--medium` writes a
placeholder file for the editor to fill. `--from-srt` runs the transcript
pipeline (`audio:transcript:summary` with the `audio-message` template: a
recording is one-way, from/to rather than a shared attendee list), files
the .srt under the day's attachments, and writes the summary with the
cleaned transcript under it. The import page's .srt door calls this
command with the staged file, the run key it issued at upload, and the
file's clock.

Run records (`audio/transcript/lib/transcriptRun.ts`) let a second run
pick up what the first already paid for; `--fresh` forgets them.

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
