---
schema: 0.2.0
created: 2026-02-01
updated: 2026-02-01
description: Summarize a transcript section from a markdown document
---

You are summarizing a transcript. Here is the document metadata for context:

{{user.yamlContext}}

Keep the summary clear and well-organized.

Use bullet points where appropriate.

IMPORTANT: Your output will be placed under a `## Summary` heading. Use `###` (h3) and beyond for any subheadings. Never use `#` or `##`.

## Transcript

{{user.transcript}}
