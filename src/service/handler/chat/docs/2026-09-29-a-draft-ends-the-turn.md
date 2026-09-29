---
created: 2026-09-29
updated: 2026-09-29
---

# A draft ends the turn

Asked to "write a new intro email" between two contacts, the chat ran
Ghostwriter, a research call for a missing address, and the Gmail draft
tool in one turn. The draft frame appeared with Edit greyed out, and under
it the tool's approval card waited for a go. The owner could not edit the
words before they went to Gmail.

## Why it happened

- Nothing in the prompt ended the turn after a drafted message. "Drafts in
  Chat" said the owner revises here, but the calendar and notebook-creation
  sections teach the opposite habit for their tools: proceed to the tool in
  the same turn, the approval card is the confirmation. The Gmail tool's own
  description, "waits in Gmail Drafts for the user to review and send by
  hand", made placement look harmless. Its approval gate was the only
  checkpoint.
- The page disables every draft frame while the turn is not idle, and a
  pending approval keeps the turn alive. Copy and Versions never take that
  flag, which is why they still worked.
- Editing during the wait would not have helped: the card's payload is the
  tool input, fixed when the model called it.
- Declining resolved the call with "User declined. Do not request this tool
  again." The owner's Not now meant "not this text", but the thread was
  told never to place it.

## What changed

- The shared chat prompt's "Drafts in Chat" section now says a message
  drafted in the owner's voice ends the turn. The verb in the request
  decides: "write" and "draft" stop with the draft in chat; "send",
  "email her", and "put this in my Gmail drafts" ask for placement, so the
  tool follows in the same turn and its card confirms. Placement carries
  the current version word for word, including the owner's edits.
- A declined call now tells the model it was a no to that input or that
  moment, not to the tool: do not run it again this turn, wait for
  direction, and a later turn may ask again with new input. The web route,
  the terminal, and the engine's same-turn auto-deny all say so.

The calendar and notebook-creation rulings stand. Those tools create the
owner's records, and the card previews exactly what will be written. A
message in the owner's voice is different: the wording is the work, and
the owner reads it in the frame before it goes anywhere.

## Rejected

- A "Place in Gmail" action on the chat draft frame, as Outbox has. It is
  the fuller fix and may still come, but it adds a surface where a prompt
  rule restores the review step today.
- Keeping the frame editable while the card waits, with Allow sending the
  frame's current text. The payload is fixed at call time, and the card
  would show words other than the ones it creates.
