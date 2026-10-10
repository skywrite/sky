---
created: 2026-10-09
updated: 2026-10-09
---

# Sky revises its own draft in the same turn

## What was wrong

One chat reply could leave several draft frames for a single message. Sky
drafted the message, read it back, and asked the writer to fix it, up to three
times before answering. Each call became its own unsaved draft, so the page
listed every attempt as a separate frame under one reply.

Two causes:

- **A new draft came back without an id.** Since
  [a draft is saved when it is used](2026-09-20-a-draft-is-saved-when-it-is-used.md),
  a new draft has no record, and the `draftId` the result used to carry went
  with the record. The drafts list in the instructions is built when the turn
  starts, so it could not name the new draft either. Sky had nothing to point a
  revision at, and every call made another draft. Before that change, a
  same-turn revision passed the returned id and became version 2.
- **The words to revise were dropped.** Without an id, Sky passed the draft's
  text as `original`. The tool schema offers `original` on every action, but the
  `draft` action's parser had no such field, so it was stripped and the call
  still succeeded. The writer never saw the message it was asked to correct and
  rewrote it from the request alone. A two-word correction came back as a
  different message that no longer contained the actual ask.

## The change

- A new draft's result carries a provisional `draftId`, `draftRevision: 1` and
  `unsaved: true`. The id is recorded with the tool result, so every read of the
  chat lists the draft under it.
- A revision of that draft before the turn ends runs the writer on the draft's
  current words and becomes its next version. The draft stays unsaved: Sky
  correcting words the owner has not seen is not the owner's use. A revision in
  a later turn still saves the record first, as before.
- `original` is part of the draft request. Without a `draftId`, it names this
  chat's draft whose current words match it exactly; otherwise the writer
  revises those words, which covers a message pasted into chat or the terminal.
  The request becomes direction, never a replacement for the text.

## Rejected

- **Saving the record on Sky's own revision.** It would put words the owner
  never touched into `me/voice/drafts/`, which the save-on-use rule exists to
  prevent.
- **Rejecting `original` on `draft`.** The writer still needs a way to revise
  words that have no draft, and a refused call costs a model round trip.
- **Listing mid-turn drafts in the instructions.** They are built once per
  turn; the tool result is where a new draft can name itself.
