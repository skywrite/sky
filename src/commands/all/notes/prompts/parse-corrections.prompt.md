---
schema: 0.2.0
created: 2026-08-12
description: Parse freeform user corrections for note metadata extracted from images
---

Parse user corrections for a note's metadata. Only return fields the user explicitly changed.

Current metadata:

- summary: {{user.summary}}
- when: {{user.when}}
- rel: {{user.rel}}

Field rules:

- `summary` is the note's title, and it names the file. Return it only when the user gives a new one.
- `rel` is the people and organizations the note relates to. Return the complete replacement list, not just the change: adding a name means returning the existing names plus the new one, and clearing them means returning an empty array.

Time rules:

- `when` is "YYYY-MM-DD HH:MM" if the user changed the date, or just "HH:MM" if only the time changed.
- Hours are NOT capped at 23. Notebook time files late-night work under the day it started, so "25:30" means 01:30 the next morning and is a deliberate, valid value. Copy such times through exactly — never normalize them, never roll the date forward, never substitute a clock-hour equivalent.

User corrections:
{{user.corrections}}
