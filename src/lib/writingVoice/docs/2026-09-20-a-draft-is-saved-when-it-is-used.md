---
created: 2026-09-20
updated: 2026-09-20
---

# A draft is saved when it is used

## What was wrong

Every draft Sky wrote became a file in `me/voice/drafts/` at once. Chat
saved one for each `me_voice` result, the Outbox check saved one for each
prepared reply, and opening an older Outbox item saved one too. Each file
also cost a naming call. Most prepared replies are never touched, so the
folder filled with words the owner had never worked on.

The folder sits under `me/`. A file there reads as the owner's writing,
while an untouched one is only Sky's proposal. Nothing learned from those
files: the writer reads `rules.md` and answered examples, never `drafts/`.
The owner could not know that from the folder, and deleted it to be safe.

That deletion broke three things. An Outbox item whose `draftId` named a
missing file threw on every read, which took the whole list down with it.
A chat that linked a missing draft failed its draft listing before it
reached the words recorded in its own transcript, so the frame lost its
editor. Branching such a chat failed outright, because copying the draft
required the file.

## The rule

A draft gets a notebook record at its first use. A use is one of:

- the owner edits the words, in a frame or by supplying an edit in chat;
- the owner asks Sky to revise them, by the button or by typing it;
- the owner accepts or restores a version;
- the owner approves the reply into its app, or records it as sent.

Until then the words stay where Sky wrote them. A chat keeps them in the
recorded `me_voice` result of its turn. An Outbox item keeps them in its
own state file, outside the notebook. Both surfaces show them in the
shared editor as an **unsaved** draft, built on each read from that
source alone, so every read returns the same versions and revision.

The record is named when it is saved, so a first use keeps the readable
date and summary name. An unsaved draft's id is only a stable handle for
the page and the model. It is replaced by the record's id at the first
use; the chat page swaps the frame in place, and the model is told to use
the ids its tool returns.

A use that cannot complete saves nothing. The chat route tries a change on
the shown words before saving the record. A revision saves the record only
after the writer returns. An Outbox write that loses its revision race
removes the record it had just saved, unless the item already links it.

## Deleted files

The owner may delete any draft file. The item or chat then falls back to
the words it still holds: an Outbox item shows its last approved wording,
or else Sky's original, and drops the dead link at its next write; a chat
shows the recorded result as an unsaved draft again. Branching skips a
draft that has no file. A damaged file is still an error: only a missing
one is treated as the owner's choice.

## Learning

Nothing changes. The saved history starts with the words as the owner saw
them, so a first edit still pairs Sky's version with the owner's. Earlier
approvals replayed into a new record are marked as already taught; the
first use itself is not, or its learning question would never be asked.
Approving a reply as written accepts its first version and teaches
nothing.

## Rejected

Saving every draft as before, but under machine state until its first use.
It keeps the folder clean, yet still writes and names a file for words
nobody wanted, and adds a second location and a sweep.

Treating a revision typed in the main chat as a new, separate draft. It
needed no ids for unsaved drafts, but each reply then carried its own
editable frame and the revision lost its history. A typed request is the
same act as the button, so it is a use.

Counting Copy as a use. Copying is not evidence that the words went out;
"Record that I sent it" is.
