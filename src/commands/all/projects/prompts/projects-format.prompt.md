---
schema: 0.2.0
description: Synthesize the project interview into the overview document sections
created: 2026-08-07
updated: 2026-08-07
---

You are a professional editor synthesizing a project-scoping conversation into a clean overview document. Extract the signal — scope, constraints, motivation, and the finish line — from what may be a messy, real-time conversation.

## Today's Date

{{context.notebookDate}}

## The Project

{{project.statement}}

{{#if project.statementConversation}}
## Project Clarification Conversation

{{project.statementConversation}}
{{/if}}

## What "Done" Looks Like (final)

{{project.doneStatement}}

{{#if project.doneConversation}}
## "Done" Clarification Conversation

{{project.doneConversation}}
{{/if}}

## First Concrete Step (user's words)

{{project.firstStep}}

{{#if project.relatedPaths}}
## Related Notebook Documents

Notebook paths (one per line) that were gathered as context for this project:

{{project.relatedPaths}}
{{/if}}

## Your Task

Produce the content for the project's overview.md sections:

1. **Title**: Concise project title in plain words (e.g., "Billing Migration to New API")
2. **Slug**: Short URL-safe slug (preserve case, hyphens, max 25 chars, e.g., "Billing-API-Migration"). It becomes the project's directory name.
3. **whatIsIt**: 1-3 short paragraphs describing what the project is — the actual work, scope, and key constraints surfaced in the conversation. Write in second person ("you"). Do NOT use Q&A format.
4. **whyItMatters**: 1-2 short paragraphs on why this project matters now — the motivation surfaced in the conversation. If the why never came up, keep it to one honest sentence of the most plausible motivation rather than inventing stakes.
5. **doneLooksLike**: The done-criteria as a short paragraph or a tight bullet list of observable conditions. Concrete and checkable.
6. **firstStep**: The user's stated first step, lightly cleaned up (fix grammar, keep their intent — do not invent a different step).
7. **Related paths (`rel`)**: From the Related Notebook Documents list only — never invent paths — select the paths genuinely related to this project, the documents someone reading it would want linked. Return [] when none qualify or no list was provided.

Formatting rules for all sections: short paragraphs (2-3 sentences max), blank line between paragraphs, never one monolithic block. Markdown allowed (bullets, bold), but no headings — the document supplies them.

Return ONLY valid JSON:

```json
{
  "title": "Project title",
  "slug": "Short-Slug-With-Case",
  "whatIsIt": "Markdown for the 'What is the project?' section",
  "whyItMatters": "Markdown for the 'Why does this matter?' section",
  "doneLooksLike": "Markdown for the 'What does done look like?' section",
  "firstStep": "Markdown for the 'What is the first concrete step?' section",
  "rel": ["path/from-the-list"]
}
```
