---
created: 2026-09-07
updated: 2026-09-07
---

# Calendar actions in conversation

The scheduler could prepare and save invitations and event updates, but its
commands were excluded from chat and voice. Decorating the commands alone would
have asked for permission before even resolving an ambiguous guest. Voice also
ignored the conditional approval hook that chat already supported, and its generic
summary of a save would have read only a draft ID.

Both commands now expose their natural-language preparation and durable send
operations. Their conditional approval policy exempts preparation and receipt
reads. Voice applies the same policy, drops blank optional inputs before checking
it, and awaits the command's formatter before parking a call. Each call's abort
signal reaches the formatter and command. Existing spoken confirmation remains
single-use; cancelling or ending a session cannot execute a pending call.

The review comes from the immutable draft in the scheduler service. The model
supplies its ID, and the service returns the original account, guests, timing,
assumptions, conflicts and before/after changes. Approval is never reconstructed
from model-written prose. The summary is saved with the draft; older drafts
require their current availability to match the original review before a summary
can be reconstructed. Formatter failures stop the approval, and saves retain
their version and availability checks.

The prompts distinguish calendar events from notebook meeting documents and
carry clarification answers into the next self-contained request. Once a person
chooses an event, its exact identity is carried into subsequent updates. A ready
draft is not described as a completed event. The new read-only status argument
retrieves the durable job after a delay or disconnection without asking to save
again or starting a replacement invitation.

Synthetic integration tests use the real command discovery, schemas, chat
approval policy, formatter, voice adapter, HTTP routes and scheduler. They cover
guest/email and event clarification, matching chat/voice review text, approval,
cancellation and revision, duplicate confirmation, receipt lookup, invalid and
missing drafts, stale events, and legacy drafts. Provider writes stay inside the
temporary fixture; no real invitations are sent.
