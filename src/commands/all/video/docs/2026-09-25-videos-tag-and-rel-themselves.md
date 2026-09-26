---
created: 2026-09-25
updated: 2026-09-25
---

# Videos tag and rel themselves

## Before

An .srt dropped on the day's import page became a video file with a
summary, the transcript, and the people the pipeline heard discussed, but
with `tags:` empty and `rel:` holding only what the transcript extraction
found. Meetings, notes, journals, Slack threads and recaps had all learned
to fill those slots from their own archives. The video door had not, and
the archive showed the person filling them by hand: most videos since the
taxonomy floor carry hand-written tags.

## Change

`video:new --from-srt` runs the auto-tag and auto-rel classifiers after
the write-up, against a new `video` corpus medium, and writes what they
return. The pipeline's own rel stays first; auto-rel appends. The flags
every other capture offers, `--no-auto-tag` and `--no-auto-rel`, exist
here too, and the import page shows the step as "Adding tags and links".

## Why the speaker is the conversation

The stack keys its tag history and rel exemplars on one identity per
record. Messages use `to:`, the channel or counterparty. A video is
one-way: `from:` is who recorded it and is the field that recurs, as with
a colleague sending a weekly walkthrough, while `to:` is set less often.
So a video record keys on `from:`, falling back to `to:`.

Overloading the classifiers' `to` input with the speaker was rejected: the
prompts would then read the speaker as both parties, and the real
recipient would drop out of the party exclusion that keeps `from:` and
`to:` from being proposed as rel. A `conversation` input carries the key
instead, defaulting to `to` for every other caller.

## What was not done

- The corpus is the video archive alone, as with recaps: a closed menu is
  the point.
- The manual path (`sky video:new "Title" --from Jane`) is not enriched.
  A title alone is too little to classify; the body gets written in the
  editor afterwards.
- Messages captured from the page (a .vtt, a notetaker's .txt, a
  screenshot, a voice memo) are not enriched either; `message:new` never
  was. Same shape, separate change.
