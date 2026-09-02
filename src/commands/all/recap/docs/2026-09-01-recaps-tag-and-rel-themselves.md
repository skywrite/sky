---
status: shipped
created: 2026-09-01
updated: 2026-09-01
---

# Recaps tag and rel themselves

## Before

A recap was written with `rel:` and `tags:` as empty slots for the user
to fill by hand, carried across re-runs. Every other capture kind had
long since learned to fill those slots from its own archives. Recaps had
not, and the user was filling them anyway: by the day this shipped,
nearly every recap in the notebook carried hand-written tags and most
coding recaps a hand-written project ref, with the same values day after
day per app.

## Change

Both recap writers call `enrichRecap` before creating the document. It
runs the auto-tag and auto-rel classifiers together against a new
`recap` corpus medium and returns the curation with empty slots filled.
Hand values and `--rel` are untouched. The flags every other capture
offers, `--no-auto-tag` and `--no-auto-rel`, exist here too.

## Why the app is the conversation

The enrichment stack keys its priors on a conversation identity: the
Slack channel, the email counterparty, the meeting's `who:`. Journals,
chats, and notes have none, so their whole medium is one conversation.
A recap does have one: the app it digests. Keying on `app:` gives each
app its own tag history and rel exemplars, which is exactly how the
hand-curated archive already reads, one steady tag per app and one
project ref on the coding recaps.

## The recaps outside this repo

The nutrition and lifting recaps live in a separate command tree and had
been writing one hard-coded tag each, without reading the file back, so a
re-run also erased any hand edit. The archive showed nearly every
nutrition recap re-tagged by hand to a different tag. They now read the
day's existing curation and fill the empty slots the same way, through a
new `@skywrite/core/recap` entry that exposes the helper and the curation
reader. The hard-coded tag remains the floor when the classifier abstains.

## What was not done

- The corpus is the recap archive alone. Widening the tag menu to other
  mediums would let a recap borrow a tag no recap ever used; the closed
  menu is the point.
