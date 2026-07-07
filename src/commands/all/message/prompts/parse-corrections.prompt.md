---
schema: 0.2.0
created: 2026-02-15
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

Sender rename rules:

- If the user renames a person (e.g. "Me is Alex", "Sarah -> Sarah Kim"), return it in senderRenames. The rename's "from" must be an exact name from the dialogue sender list.
- If the user corrects the from or to field and its current value is also a dialogue sender name, additionally return a senderRename from the old name to the new one (e.g. from is currently "Me" and the user says the message is from Alex: set from to "Alex" and rename sender "Me" to "Alex").
- If a renamed sender's old name is the current from or to value, also update that field to the new name.
- Never rename a sender that is not in the dialogue sender list.

User corrections:
{{user.corrections}}
