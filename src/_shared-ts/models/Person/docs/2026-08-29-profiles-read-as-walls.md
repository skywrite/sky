---
created: 2026-08-29
updated: 2026-08-29
---

# Profiles read as walls

## What was wrong

Three days after the distiller shipped (2026-08-26), the profiles it had
touched looked like this (synthetic):

```markdown
## Overview

Overview

Taylor is Platform Lead at Example Corp, reporting to the CTO, joined in early 2026 and has deep connections across the region, met the user in May 2025, and in late August 2026 delivered structured feedback on working at Example Corp—lack of predictability in objectives, unclear expectations, frequent focus shifts—and offered concrete suggestions including shared metrics meetings, postmortem processes, defined budgets, and regional structures. (…120 words on one line)

## Info

Tracks the vendor volume metrics and the profit scoreboard; actively involved in data quality and bank statement visibility work with Jordan.
```

Four defects:

1. The Overview was a paragraph. 82 to 215 words, one line. The prompt
   asked for "2–6 sentences"; the model wrote six long ones.
2. Seven of nine Overviews began with a bare `Overview` line. The model
   returned `## Overview` as the first line of the body; the applier
   stripped the `##` and kept the word.
3. Notes chained facts. The schema asked for "one sentence"; the model
   complied by joining facts with semicolons. Several were status updates,
   filed under `## Info`.
4. Append-only had no correction path. A stale line could only gain a
   contradicting neighbor.

The rule that came out of it: everything the AI writes into a profile must
read at a glance. Short lines. One fact each. No chains.

## Tried and rejected

- Splitting only, no cap. A chained line becomes short lines, but a single
  40-word sentence still lands. The cap is what makes the law hold.
- Trimming an over-cap line. Silently loses the tail of a fact. Refuse
  instead, with the reason on the 👤 line.
- Refusing one over-cap Overview line and writing the rest. The Overview
  replaces the old one wholesale, so a partial one loses facts the old one
  held. Refuse the whole op; the old Overview stays.
- Splitting on em-dashes. Mangles names and parenthetical asides. Asked for
  in the prompt only.
- `replace` by substring. Partial replacement inside a line produces
  garbage. Whole-line key match only.
- Reformatting hand-written paragraphs into bullets on touch. Hand content
  is not the AI's to reshape.

## Why the fix works

- The model is asked for `lines: string[]` instead of a paragraph. A list of
  facts is a different task from prose, and the model treats it as one.
- The applier normalizes first (`toFactLines`), then enforces the cap. What
  the model still gets wrong is refused, and the refusal names the rule.
- One constant per knob, read by the schema, the prompt, and the applier.
- `replace` needs a verbatim quote. No match, no write.
- The heading echo drops on touch, so the affected files heal on their next
  applied op.
