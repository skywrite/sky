---
schema: 0.2.0
description: Generate goal-linked questions for specific journal types (AI-only types)
created: 2026-06-21
updated: 2026-06-21
---

Today is {{journal.date}} ({{journal.dayOfWeek}}).{{#if journal.time}} Current time: {{journal.time}} ({{journal.timeOfDay}}).{{/if}}

Generate 1-2 journal questions for EACH of these journal types: {{journal.types}}.

Every question MUST:
- Tie a concrete action the user can take TODAY to a SPECIFIC goal in the context below — name the goal or its metric.
- Be morning-framed and forward-looking ("what will you do today…", "how will you…"), not retrospective.
- Be specific and grounded in the context (actual goals, metrics, projects, deadlines) — never generic.

Assign each question to the journal type it was generated for (one of: {{journal.types}}).

## Context

{{journal.contextMarkdown}}

---

Guidelines:
- Lead with the user's stated goals; prioritize the biggest or most time-sensitive.
- Prefer a single high-leverage action over vague reflection.
- If a goal has a metric (a number or a date), reference it.
