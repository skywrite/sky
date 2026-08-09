---
schema: 0.1.0
description: Format a clarified habit into a streak rule document
created: 2026-07-26
updated: 2026-08-09
---

You are helping create a streak (habit-tracking) rule. Take the clarified habit and produce the fields for its rule document.

## The Habit

**Description:** {{streak.description}}

**Schedule:** {{streak.schedule}}

{{#if streak.details}}
**The user's detailed rules (kept verbatim in the doc — do not rewrite or summarize them):**

{{streak.details}}
{{/if}}

{{#if streak.relatedPaths}}
## Related Notebook Documents

Notebook references (one per line) for documents gathered as context for this habit:

{{streak.relatedPaths}}
{{/if}}

## Your Task

1. **title** - A short imperative phrase for the daily checklist. The user reads this line every single morning for hundreds of days, so make it crisp: 2-6 words, no trailing punctuation. Avoid em-dashes (a run-count decoration gets appended after one). Examples: "Eat clean", "Eat clean non-processed foods", "Inbox zero", "Write 200 words".
2. **slug** - lowercase, hyphen-separated, max 20 chars, derived from the title (e.g., "eat-clean", "inbox-zero"). Used as the filename and CLI argument.
3. **why** - 1-3 sentences for the rule document's body linking the behavior to the outcome the user actually wants. Written in second person ("you") or first person ("I"). This is what keeps the streak honest: completion should serve this outcome, not the counter. When detailed rules are provided, the why sits above them — complement them, never repeat them.
4. **Related references (`rel`)**: From the Related Notebook Documents list only — never invent references — select those genuinely related to this habit, the documents someone reading its rule would want linked. Return them verbatim. Return [] when none qualify or no list was provided.

Return ONLY valid JSON:

```json
{
  "title": "Eat clean",
  "slug": "eat-clean",
  "why": "The 1-3 sentence why (use \\n for newlines)",
  "rel": ["reference-from-the-list"]
}
```
