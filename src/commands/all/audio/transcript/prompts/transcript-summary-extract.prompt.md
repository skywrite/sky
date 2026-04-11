---
schema: 0.2.0
created: 2026-01-19
updated: 2026-01-26
description: Extract structured metadata from a meeting summary
---

Extract the title, time, duration, and medium from this meeting summary.

Today's date is {{context.notebookDate}}.

## Summary

{{user.input}}

## Output

Return ONLY valid JSON (no markdown fences):

```json
{
  "title": "Meeting title from the summary",
  "time": "2026-01-18 09:45",
  "durationMinutes": 7,
  "medium": "Zoom",
  "who": ["Alice Smith"],
  "rel": ["Bob Jones"]
}
```

- **title**: The title from the ## Title section
- **time**: The meeting time as local wall-clock time (NOT UTC). Format: YYYY-MM-DD HH:MM (24-hour, space separator). Example: "9:45 AM on January 18th" → "2026-01-18 09:45"
- **durationMinutes**: Number of minutes if mentioned (e.g., "7 minute call"), otherwise null
- **medium**: The call/meeting medium if stated (e.g., "Zoom", "Phone", "Google Meet", "Teams", "In Person"). null if not mentioned.
- **who**: Attendees - people who were IN the meeting (from ## Attendees section)
- **rel**: Related people - people MENTIONED or discussed but not attending. If unsure whether someone attended, put them here.
