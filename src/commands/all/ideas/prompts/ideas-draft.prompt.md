---
schema: 0.2.0
description: Draft a complete idea document from conversation inputs, with open questions carrying proposed answers
created: 2026-08-09
updated: 2026-08-09
---

You are drafting an Idea document from a conversation that has already explored the topic. Produce the best complete draft the inputs support, plus the shortest possible list of open questions. Never interrogate what the inputs already settle.

A well-formed idea makes clear WHAT is being proposed and WHY it matters or what problem it solves. Where the inputs fall short, still draft your best reading — and raise the gap as an open question with a concrete proposed resolution.

## Inputs

IDEA STATEMENT:
{{idea.statement}}

{{#if idea.conversation}}
CONVERSATION EXCERPTS:
{{idea.conversation}}
{{/if}}

{{#if idea.notebookContext}}
NOTEBOOK CONTEXT (recent documents, goals, projects relevant to this idea):
{{idea.notebookContext}}
{{/if}}

{{#if idea.relatedPaths}}
RELATED NOTEBOOK DOCUMENTS (references, one per line):
{{idea.relatedPaths}}
{{/if}}

## Your Task

1. **title**: A concise, clear name for the idea (no "Idea:" prefix)
2. **slug**: Short URL-safe slug (preserve case, hyphens, max 25 chars)
3. **body**: Clean narrative markdown — what the idea IS, why it matters, and what it might look like in practice. Second person ("you") or first person ("I/we"). No Q&A format. Ground it in the notebook context where relevant. **IMPORTANT: short paragraphs (2-3 sentences max), blank line between each, bold lead-ins for distinct threads. Never one monolithic block — white space is your friend.** Unknown facts that shape the idea (numbers to confirm, external states nobody in the conversation knows) belong IN the body as a short trailing **Open** list — never as questions to the user.
4. **rel**: From the Related Notebook Documents list only — never invent references — the ones genuinely related, verbatim. [] when none qualify.
5. **openQuestions**: ONLY drafting calls the user can answer from their head in one line — preference, scope, ownership, naming. Never facts they would have to go find out (those go in the body's Open list). Each has "question" (one sentence), "why" (what settling it protects), and "proposed" (the concrete answer you would apply). Maximum 3, usually zero — an empty array is the normal case. A question whose answer is already in the inputs is a defect.

Return ONLY valid JSON:

```json
{
  "title": "Idea title",
  "slug": "Short-Slug-With-Case",
  "body": "Markdown body (use \\n for newlines)",
  "rel": ["reference-from-the-list"],
  "openQuestions": [{ "question": "...", "why": "...", "proposed": "..." }]
}
```
