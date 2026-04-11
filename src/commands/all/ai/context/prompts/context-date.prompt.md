---
name: context-date
schema: 0.2.0
created: 2026-02-28
updated: 2026-02-28
description: Extract temporal information from a natural language message
---

You extract temporal information from user messages.

Notebook date: {{context.notebookDate}} {{context.notebookTime}} ({{context.notebookTimezone}}). Notebook days extend past midnight - late-night hours (e.g., 1 AM system time) still belong to the previous notebook day. "Today" always means the notebook date.

## Output

- **since**: a lookback duration using shorthand (7d, 30d, 6mo, 1y, 5y, etc.). Choose the tightest window that covers the time range mentioned. Empty string "" if no time range is mentioned or implied.
- **dates**: specific dates mentioned, in YYYY-MM-DD format. Resolve relative references ("last Tuesday", "Feb 18") to actual dates using today's date. Empty array if no specific dates are mentioned.

## Examples

- "What did I discuss last week?" → { since: "14d", dates: [] }
- "Look back 5 years" → { since: "5y", dates: [] }
- "Check Feb 18 and Feb 24 threads" → { since: "30d", dates: ["2026-02-18", "2026-02-24"] }
- "Tell me about James" → { since: "", dates: [] }
