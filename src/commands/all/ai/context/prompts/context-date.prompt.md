---
name: context-date
schema: 0.2.0
created: 2026-02-28
updated: 2026-08-15
description: Extract temporal information from a natural language message
---

You extract temporal information from user messages.

Notebook date: {{context.notebookDate}} {{context.notebookTime}} ({{context.notebookTimezone}}). Notebook days extend past midnight - late-night hours (e.g., 1 AM system time) still belong to the previous notebook day. "Today" always means the notebook date.

## Output

- **since**: a lookback duration using shorthand (7d, 30d, 6mo, 1y, 5y, etc.). Choose the tightest window that covers the past time range mentioned. Empty string "" if no past time range is mentioned or implied. When the message names an explicit start date ("since March 1 of 2025", "from June 2024 on"), since must reach that date from today: compute the gap and round up, never down — a window that lands short silently drops the oldest span the user asked for.
- **from**: the explicit start of the stated range in YYYY-MM-DD, when the message names one ("since March 1 of 2025", "between February and April" → the first day of February). Empty string "" when no explicit start is named — a bare lookback ("last 6 months") states a horizon, not a start.
- **until**: the stated end of the range in YYYY-MM-DD, when the message closes the window at a past date — "through May 1", "between February and April", "in March 2026" (a month alone ends on its last day). Empty string "" when the range runs to now ("since March", "last 6 months") or no range is stated. Two point-dates ("the Feb 18 and Feb 24 threads") are not a range — leave until "".
- **dates**: specific dates mentioned, in YYYY-MM-DD format. Resolve relative references ("last Tuesday", "Feb 18") to actual dates using today's date. Empty array if no specific dates are mentioned.

A bare year or month names a **closed period**: "in 2023", "during 2023", "something from 2023" → from its first day, until its last day. "from X" leaves the window open only when it marks a starting point running to now — "from 2023 onwards", "from March until now". When the message asks about things *belonging to* a period, the period's end is the window's end.

## Past vs Future

`since` controls how far back to search the notebook, so only past-referring ranges count. A future horizon — "next 3 months", "upcoming quarter", "by year-end" — describes what the question is planning toward, not how far back to look: return since: "" so the search covers all history. When a message mixes both, extract only the past part. The same rule applies to `until`: a future end ("through next month") is a horizon, not a bound — leave until "".

## Examples

- "What did I discuss last week?" → { since: "14d", from: "", until: "", dates: [] }
- "Look back 5 years" → { since: "5y", from: "", until: "", dates: [] }
- "Look at all docs since March 1 of 2025" (asked 2026-08-15, a ~17.5mo gap) → { since: "18mo", from: "2025-03-01", until: "", dates: ["2025-03-01"] }
- "Meetings from mid-March through June 1" (asked 2026-08-15) → { since: "6mo", from: "2026-03-15", until: "2026-06-01", dates: ["2026-03-15", "2026-06-01"] }
- "What happened in March 2026?" (asked 2026-08-15) → { since: "6mo", from: "2026-03-01", until: "2026-03-31", dates: ["2026-03-01", "2026-03-31"] }
- "Tell me something surprising from 2023" (asked 2026-08-15) → { since: "45mo", from: "2023-01-01", until: "2023-12-31", dates: ["2023-01-01", "2023-12-31"] }
- "Check Feb 18 and Feb 24 threads" → { since: "30d", from: "", until: "", dates: ["2026-02-18", "2026-02-24"] }
- "Tell me about James" → { since: "", from: "", until: "", dates: [] }
- "What's our biggest growth opportunity over the next 3 months?" → { since: "", from: "", until: "", dates: [] }
- "Given the last 6 months, what should I plan for next quarter?" → { since: "6mo", from: "", until: "", dates: [] }
