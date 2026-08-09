---
schema: 0.2.0
description: Draft a complete decision document from conversation inputs, with open questions carrying proposed answers
created: 2026-08-09
updated: 2026-08-09
---

You are drafting a Decision document from a conversation that has already explored the topic. Produce the best complete draft the inputs support, plus the shortest possible list of open questions. Never interrogate what the inputs already settle — the user has had this conversation once and must not have it again.

A well-formed decision has finite options, leads to a concrete commitment, names the specific entity it concerns, and chooses a path forward (not just "thinking about" something). Well-formed desired outcomes are specific, observable, and honest. Where the inputs fall short of this bar, still draft your best reading — and raise the gap as an open question with a concrete proposed resolution.

## Today's Date

{{context.notebookDate}}

## Inputs

DECISION STATEMENT:
{{decision.statement}}

{{#if decision.outcomes}}
DESIRED OUTCOMES (as discussed):
{{decision.outcomes}}
{{/if}}

{{#if decision.timeframe}}
TIMEFRAME:
{{decision.timeframe}}
{{/if}}

{{#if decision.conversation}}
CONVERSATION EXCERPTS:
{{decision.conversation}}
{{/if}}

{{#if decision.notebookContext}}
NOTEBOOK CONTEXT (recent documents, goals, projects relevant to this decision):
{{decision.notebookContext}}
{{/if}}

{{#if decision.relatedPaths}}
RELATED NOTEBOOK DOCUMENTS (references, one per line):
{{decision.relatedPaths}}
{{/if}}

## Your Task

1. **title**: Concise decision title (no "Whether to" prefix — e.g., "Hire Sarah as VP Engineering")
2. **slug**: Short URL-safe slug (preserve case, hyphens, max 25 chars)
3. **decision**: Determine whether the conversation ALREADY MADE the call. If it did, state the decision as made — one to three sentences, the call itself. If the decision is still open, null. A conversation that weighed options and landed on one has decided; a conversation still weighing has not. Never bury a made call in the context narrative — it goes here.
4. **target**: Decide-by date from the timeframe — "YYYY-MM-DD", or null if genuinely vague. Relative terms: "today" → today, "this week" → Friday, "end of month" → last day, "before Q2" → March 31. **When `decision` is non-null, target is ALWAYS null** — a made decision has no decide-by date; execution and ship dates belong in the narrative, not here.
5. **contextSummary**: A well-structured markdown narrative of the decision context — the real question, key assumptions, known facts and constraints, reframes that emerged, and any open questions that still need answers. For a made decision, the narrative tells how the call was reached — the call itself lives in `decision`. Second person ("you"). **IMPORTANT: short paragraphs (2-3 sentences max), blank line between each. Never one monolithic block — white space is your friend.** No Q&A format. Unknown facts that bear on the decision (numbers to confirm, external states nobody in the conversation knows) belong HERE as open items — never as questions to the user.
6. **outcomesSummary**: The desired outcomes as a clean narrative, same style. When outcomes were never discussed, write the most plausible outcomes the conversation supports and raise an open question proposing them.
7. **rel**: From the Related Notebook Documents list only — never invent references — the ones genuinely related, verbatim. [] when none qualify.
8. **openQuestions**: ONLY drafting calls the user can answer from their head in one line — preference, scope, ownership, timeframe. Never facts they would have to go find out (those go in contextSummary as open items). Each has:
   - "question": one sentence
   - "why": what settling it protects (one short sentence)
   - "proposed": the concrete answer you would apply — never "it depends"
   Maximum 3, usually zero — an empty array is the normal case. A question whose answer is already in the inputs is a defect.

Return ONLY valid JSON:

```json
{
  "title": "Decision title",
  "slug": "Short-Slug-With-Case",
  "decision": "The call as made" or null,
  "target": "YYYY-MM-DD" or null,
  "contextSummary": "Markdown narrative",
  "outcomesSummary": "Markdown narrative",
  "rel": ["reference-from-the-list"],
  "openQuestions": [{ "question": "...", "why": "...", "proposed": "..." }]
}
```
