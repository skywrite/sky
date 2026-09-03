---
schema: 0.2.0
created: 2026-01-19
updated: 2026-09-03
description: Extract structured metadata from a meeting summary
---

Extract the title, time, duration, and medium from this meeting summary.

Today's date is {{context.notebookDate}}.
{{#if stated.when}}
The meeting began at {{stated.when}} — the notebook owner said so. That is its `time`, and relative dates in action items resolve against it.
{{/if}}
{{#if clock.recorded}}
The notes were recorded at {{clock.recorded}}, after the meeting they recount. `time` is when the meeting itself was held, as the summary states it — a bare weekday or "this morning" there is read against the recording's date, not today's — and null when the summary gives none. Relative dates in action items resolve against the recording's date.
{{/if}}
{{#if clock.start}}
The file's clock puts the meeting's start at {{clock.start}}. `time` is the start as the summary states it, on that date when the summary gives only a clock, and null when it gives none. Relative dates in action items resolve against that date.
{{/if}}

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
  "rel": ["Bob Jones"],
  "actionItems": [
    { "text": "Send the revised proposal to Alice Smith", "mine": true, "date": "2026-01-20", "time": null }
  ]
}
```

- **title**: The meeting title — the text of the top-level `#` heading in the summary
- **time**: The meeting time as local wall-clock time (NOT UTC). Format: YYYY-MM-DD HH:MM (24-hour, space separator). Example: "9:45 AM on January 18th" → "2026-01-18 09:45"
- **durationMinutes**: Number of minutes if mentioned (e.g., "7 minute call"), otherwise null
- **medium**: The call/meeting medium if stated (e.g., "Zoom", "Phone", "Google Meet", "Teams", "In Person"). null if not mentioned.
- **who**: Attendees - people who were IN the meeting (from ## Attendees section)
- **rel**: Related people - people MENTIONED or discussed but not attending. If unsure whether someone attended, put them here.
- **actionItems**: One entry per bullet in the `## Action Items (me)` and `## Action Items (others)` sections (a summary may instead have a single legacy `## Action Items` section), in document order. `[]` when those sections are missing or empty. Never invent items that aren't in them. Per entry:
  - **text**: The task as an imperative sentence, without any "(me)" marker and without a due-date phrase that `date` already captures. Keep other people's names.
  - **mine**: true for bullets under `## Action Items (me)`, false for bullets under `## Action Items (others)`. In a legacy `## Action Items` section, true only when the bullet is marked "(me)" or otherwise clearly the speaker's own responsibility.
  - **date**: The committed/due day as YYYY-MM-DD, only when the bullet states one. Resolve relative phrases ("Friday", "in two weeks") against the meeting date, falling back to today's date above. null when no day is stated, when it can't be resolved to a specific day, or when it is already past.
  - **time**: HH:MM wall-clock, only when the bullet commits to a specific clock time (e.g. "call at 3pm" → "15:00"). null otherwise.
