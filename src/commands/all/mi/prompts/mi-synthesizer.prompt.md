---
schema: 0.1.1
description: MI Synthesizer - produces a clean MI document from the interview conversation
created: 2026-02-16
updated: 2026-02-16
---

You are writing the Most Important (MI) document for a CEO's daily focus system.

Take the interview conversation below and produce a clean, well-structured MI document body in markdown. The frontmatter is handled separately — you produce ONLY the body starting from the H1 heading.

## Output Format

```markdown
# **{{synthesizer.date}} - {{synthesizer.dayWord}}**

## Focus

[1-3 sentences: the MI statement with enough context that re-reading it tomorrow makes sense. Start with the action verb.]

## Why This Matters

[2-4 sentences: strategic reasoning. How does completing this move my company toward being worth a $100B market cap? What's at stake if it doesn't get done today?]

## Done Looks Like

[Bullet list: 2-4 concrete, checkable outcomes that define "done" for today. Extract from the conversation — don't invent.]

{{#if synthesizer.dependencies}}
## Dependencies

[Who the CEO depends on and what they need to do. Be specific with names and actions.]

{{/if}}
{{#if synthesizer.notes}}
## Notes

[Any additional context the user provided, cleaned up.]

{{/if}}
## Reflection


```

## Rules

1. Use the user's own words and specifics — don't generalize or add corporate fluff
2. Keep it tight. Every sentence should earn its place.
3. "Done Looks Like" items must be concrete and checkable, not vague ("sent" not "worked on")
4. If the conversation doesn't provide enough info for a section, write a minimal version rather than inventing content
5. The Reflection section is always empty (filled in at end-of-day)
6. Output ONLY the markdown body. No code fences, no preamble.

## Interview Data

**MI Statement:** {{synthesizer.statement}}

{{#if synthesizer.dueBy}}
**Due by:** {{synthesizer.dueBy}}
{{/if}}

{{#if synthesizer.conversation}}
**Clarification Conversation:**
{{synthesizer.conversation}}
{{/if}}

**Strategic Reasoning (user's answer):** {{synthesizer.strategic}}

{{#if synthesizer.doneLooksLike}}
**What done looks like (user's answer):** {{synthesizer.doneLooksLike}}
{{/if}}

{{#if synthesizer.dependencies}}
**Dependencies (user's answer):** {{synthesizer.dependencies}}
{{/if}}

{{#if synthesizer.notes}}
**Notes (user's answer):** {{synthesizer.notes}}
{{/if}}
