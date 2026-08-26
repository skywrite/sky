---
schema: 0.2.0
created: 2026-02-15
updated: 2026-08-25
description: Extract messaging conversation data from one or more screenshots using AI vision
---

You are given one or more screenshots of the same messaging conversation. Identify the platform and participants, and transcribe the full dialogue.

Attribute every message to its sender by real name:

- Use names visible in the screenshot — bubble labels, or the chat header for the other party in a 1:1 chat.
- Outgoing messages (typically right-aligned) belong to the account owner who took the screenshot. Use their name if it is visible or supplied in the additional context; otherwise call them "Me".
- Never use placeholders like "Person 1" or "Person 2".

Direction (`from`/`to`):

- `from` is whoever sent the first message of the reconstructed conversation — the party who opened this exchange — and `to` is who they were writing to.
- This is independent of who took the screenshot: when the other party opened the exchange, they are `from` and the owner ("Me") is `to`.

Date the conversation:

- These screenshots are being filed under {{user.referenceDate}}. Resolve relative labels against that date — "Today" is {{user.referenceDate}}, "Yesterday" is the day before it.
- `when` is the first message's timestamp, since that is when the conversation started. Copy its wall clock exactly as shown — only the date is yours to resolve.
- Each message's own `time` follows the same rules. Messaging apps stamp only some messages in a run — leave the others null rather than inferring one from a neighbour.
- If no timestamp or date separator is visible anywhere, return null rather than guessing.

Summarize what the conversation is about, not who said it:

- The participants are recorded in their own fields, so never open with the sender ("Sender tells Alice…", "Me asks Bob…") or otherwise narrate who told whom.
- Write the substance as a phrase: "Dinner moved to Thursday over a scheduling conflict", not "Alice tells Bob dinner is moved to Thursday".
- Name a person only when they are what the message is about — a third party being discussed, not a participant.

When there are multiple screenshots, they were captured while scrolling through the conversation and are provided in capture order — which may not match conversation order. Consecutive screenshots usually overlap, so the same messages may appear in more than one screenshot.

Reconstruct the single chronological message stream:

- Include each message exactly once — never repeat a message that appears in multiple screenshots.
- If a message is cut off at the edge of one screenshot but fully visible in another, transcribe the complete version.
- Use visible timestamps, date separators, and overlapping runs of messages to determine the true order.
- If two screenshots do not connect (the conversation appears to have a gap between them), still transcribe both parts in order and describe the gap in continuityNotes.
