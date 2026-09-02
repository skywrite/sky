---
schema: 0.2.0
created: 2026-03-17
updated: 2026-09-02
description: Extract structured metadata from a conversation summary
---

Extract the title, time, and participants from this conversation summary.

Today's date is {{context.notebookDate}}.
{{#if stated.when}}
The conversation took place at {{stated.when}} — the notebook owner said so. That is its `time`.
{{/if}}

## Summary

{{user.input}}

## Output

Return ONLY valid JSON (no markdown fences):

```json
{
  "title": "Conversation title from the summary",
  "time": "2026-01-18 09:45",
  "durationMinutes": 7,
  "medium": "Phone",
  "from": "Alice Smith",
  "to": "Bob Jones",
  "rel": ["Charlie Brown"]
}
```

- **title**: The title from the ## Title section
- **time**: The conversation time as local wall-clock time (NOT UTC). Format: YYYY-MM-DD HH:MM (24-hour, space separator). Example: "9:45 AM on January 18th" → "2026-01-18 09:45"
- **durationMinutes**: Number of minutes if mentioned, otherwise null
- **medium**: The communication medium if stated (e.g., "Phone", "In Person", "WhatsApp", "Voice Memo"). null if not mentioned.
- **from**: The person who initiated or sent the message. null if unclear.
- **to**: The person or channel the message was directed to. null if unclear.
- **rel**: People mentioned or discussed but not participating. If unsure whether someone was present, put them here.
