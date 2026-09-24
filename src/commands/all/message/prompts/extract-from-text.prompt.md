---
schema: 0.2.0
created: 2026-09-23
updated: 2026-09-23
description: Extract messaging conversation data from the text of a conversation, dragged or copied out of a messaging app, or exported from one
---

Above is the text of one messaging conversation, between the conversation tags. It was dragged or copied out of a messaging app, or exported from one. Identify the platform and the participants, and transcribe the dialogue as messages.

Read the text's own layout:

- Apps lay a conversation out differently: `Name: words` on one line; a name and a clock on one line with the words below; a bracketed date and time before each line. Work out which parts are names, which are timestamps, and which are the words.
- Leave out what is not a message: read receipts ("Delivered", "Read 10:32"), reactions, "Edited" marks, typing notices, and the app's own buttons and labels.
- A message that runs over several lines is one message. Keep its line breaks.
- Transcribe the words verbatim. Do not correct, shorten, or merge messages. A message the text shows twice was sent twice.

Attribute every message to its sender by the name the text gives:

- Use the names in the text. A message the text marks as the account owner's — "You", "Me" — belongs to "Me", unless the owner's name is supplied in the additional context.
- A line with no name of its own continues the message or run of messages above it.
- Never invent a name, and never use placeholders like "Person 1".

Direction (`from`/`to`):

- `from` is whoever sent the first message in the text — the party who opened this exchange — and `to` is who they were writing to.

Date the conversation:

- This text is being filed at {{user.now}}. Resolve relative labels against that moment — "Today" is that date and "Yesterday" the day before it; "Now" or "Just now" is that clock, and "5 min ago" is five minutes before it.
- `when` is the first message's timestamp, since that is when the conversation started. Take an absolute clock as written, in 24-hour time — only the date, and any relative label, are yours to resolve.
- Each message's own `time` follows the same rules. Apps stamp only some messages in a run — leave the others null rather than inferring one from a neighbour.
- If the text carries no timestamp or date at all, return null rather than guessing.

Summarize what the conversation is about, not who said it:

- The participants are recorded in their own fields, so never open with the sender ("Sender tells Alice…", "Me asks Bob…") or otherwise narrate who told whom.
- Write the substance as a phrase: "Dinner moved to Thursday over a scheduling conflict", not "Alice tells Bob dinner is moved to Thursday".
- Name a person only when they are what the message is about — a third party being discussed, not a participant.
