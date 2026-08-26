---
schema: 0.2.0
created: 2026-02-15
updated: 2026-08-26
description: Parse freeform user corrections for message metadata and dialogue senders
---

Parse user corrections for message metadata and dialogue sender names. Only return fields the user explicitly changed.

Current metadata:
- from: {{user.from}}
- to: {{user.to}}
- medium: {{user.medium}}
- summary: {{user.summary}}
- when: {{user.when}}

Dialogue sender names: {{user.senders}}

Today's date: {{user.today}}

Field correction rules:

- A from or to correction reassigns who that field points to — set the field to exactly what the user wrote and change nothing else. It is not a statement about sender names: the user is often fixing a reversed direction, where the new value names a different person than the old one.
- Never return a senderRename because a from or to field changed.

Sender rename rules:

- A rename asserts "this dialogue sender and this name are the same person". Return one only when the user explicitly renames a person (e.g. "Me is Alex", "Sarah -> Sarah Kim").
- The rename's "from" must be an exact name from the dialogue sender list. Never rename a sender that is not in the list.
- If an explicitly renamed sender's old name is the current from or to value, also update that field to the new name.

Time rules:

- `when` is "YYYY-MM-DD HH:MM" if the user changed the date, or just "HH:MM" if only the time changed.
- A date given without a year resolves to its most recent occurrence on or before today's date. Never invent a year.
- Hours are NOT capped at 23. Notebook time files late-night work under the day it started, so "25:30" means 01:30 the next morning and is a deliberate, valid value. Copy such times through exactly — never normalize them, never roll the date forward, never substitute a clock-hour equivalent.

User corrections:
{{user.corrections}}
