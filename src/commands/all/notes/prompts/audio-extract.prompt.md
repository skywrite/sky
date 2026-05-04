---
schema: 0.2.0
created: 2026-05-04
description: Extract structured metadata from a notes-style summary
---

Extract the title, time, and people from this notes summary.

Today's date is {{context.notebookDate}}.

## Summary

{{user.input}}

## Output

Return ONLY valid JSON (no markdown fences):

```json
{
  "title": "Note title",
  "time": null,
  "durationMinutes": null,
  "medium": null,
  "who": [],
  "rel": ["Alice Smith", "Bob Jones"]
}
```

- **title**: From the `### Title` section. If absent, infer from the content.
- **time**: If a specific time/date is mentioned in the content, format as YYYY-MM-DD HH:MM (24-hour, local wall-clock). Otherwise null.
- **durationMinutes**: Null (rarely applicable to notes).
- **medium**: Null (rarely applicable to notes).
- **who**: Leave empty unless the note is clearly about a specific event with named participants. For most notes, leave `who` empty.
- **rel**: All other people mentioned in the content (collaborators, references, etc.). When in doubt, put names here rather than in `who`.
