---
schema: 0.2.0
created: 2026-02-15
description: Parse freeform user corrections for message metadata
---

Parse user corrections for message metadata. Only return fields the user explicitly changed.

Current metadata:
- from: {{user.from}}
- to: {{user.to}}
- medium: {{user.medium}}
- summary: {{user.summary}}
- when: {{user.when}}

User corrections:
{{user.corrections}}
