---
schema: 0.2.0
description: Develop the owner's answers into a clear, useful daily commitment
created: 2026-02-16
updated: 2026-09-21
---

Write a clear, useful daily commitment for {{synthesizer.day}}. The title should be easy to scan; the body should give the owner enough substance to understand the work and get started.

Use your own judgment and writing to improve the owner's input. Explain what to accomplish, why this particular task matters, and what finished looks like. Preserve the useful reasoning, context, and explicit scope boundaries that make it more than a generic to-do. A reason such as "provide clarity" is too thin when the notebook establishes a specific problem or tradeoff worth naming.

Keep the body readable: a short description of the work, a focused explanation of its significance, and a clear finish line. Each usually needs only one or two sentences. Length follows the task; there is no fixed word target or mandatory section checklist. Do not compress meaningful context into cryptic fragments, repeat the title under several headings, or reproduce the history and figures from a source document. Include a concrete fact only when it changes how the owner understands or approaches this task.

This document defines the work; it does not perform it. Do not write the deliverable itself, a script, talking points, a research report, or an execution plan. Do not add coaching about how to narrate, compare, evaluate, or persuade; those instructions inflate a clear task into more work. Do not ask or answer the substantive decision the task exists to produce. Leave supporting detail in its source document; retain an existing source link when it gives the owner a useful starting point.

Reconcile the task with ALL answers and edits while preserving its intended scope and stage. Sharing preliminary thinking does not become a final decision. Sending an update does not become resolving every issue it mentions. Do not invent quality gates, commitments, approvals, dependencies, restrictions on the owner's authority, or extra assignments. Completion belongs to the owner's deliverable, not the recipient's future reaction. Practical necessity, risk reduction, and clearing mental space are valid reasons; do not manufacture urgency or claim someone is blocked without evidence.

Scope boundaries must come from the owner's words or explicit evidence. "Recommend a vendor" does not imply "the team decides" or that the owner cannot approve it. Do not append boilerplate about feedback being separate work, what happens after completion, or everything the task is not. If a brief boundary is useful, fold it into the description instead of adding another section that repeats it.

Produce only:
- **summary**: a short action title, ideally 5–10 words, at most 100 characters. Verb plus deliverable, with a recipient only where useful. Keep background, rationale, qualifications, and substeps in the body. Keep an already clear, short title unless the owner's answers change the task.
- **dueBy**: only a deadline explicitly established for this task; otherwise null. Never infer a deadline from related notebook material or schedule when to work.
- **body**: Markdown beneath the title and optional deadline. Describe the intended work, give its specific reason, and make completion observable. Often a short opening paragraph followed by **Why this matters** and **Done when** is enough. Combine or omit redundant sections; add a scope note only when it changes the task. Avoid a list of all the steps needed to produce one deliverable.

Do not copy raw answers or include YAML or an interview transcript. When refining, preserve the owner's direct edits, intent, and recorded results. Shortening removes repetition and digressions while retaining useful substance. Do not strip the task into a generic benefit and finish line. If the feedback concerns the body, preserve an already suitable title.

## Initial task

{{synthesizer.statement}}

## Interview

{{synthesizer.conversation}}

{{#if synthesizer.previous}}
## Current draft, including the owner's edits

{{synthesizer.previous}}

## Requested refinement

{{synthesizer.feedback}}
{{/if}}

## Notebook context

{{synthesizer.notebookContext}}
