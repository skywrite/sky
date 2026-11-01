---
created: 2026-11-01
updated: 2026-11-01
---

# Recurring items

The manager opens at `/recurring`, alongside People & Orgs and Places above the Settings heading.
The day’s To-dos and Reminders offer contextual links to it.
Its API edits the existing `time/recurring-professional.md`, `recurring-personal.md`, and `reminders.md`.
There is no parallel store of definitions.
The first save initializes missing standard source files, because day start expects both category sources to exist.
Opening the manager creates nothing.

A heading is the repeat pattern; its list contains the definitions consumed by the CLI’s day-start extractor.
Legacy headings retain their spelling when an item’s schedule is unchanged.
Previews use the existing PatternMatcher and the notebook’s planning date, including its fixed alternating phases.
Unrecognized schedules remain visible for correction.

An item’s API address is its source file and reviewed character offset, not a persisted content ID.
File revisions and a shared writer lock prevent stale forms and concurrent adds from replacing newer definitions.
Writes patch complete Markdown blocks, preserving surrounding prose, frontmatter, notes, and references.
Moving between source files resolves links and saves the destination before removing the source.
The shared planning transaction rolls back only bytes still owned by a failed operation.

Saving or stopping a recurrence changes its definition only.
Existing daily copies remain independent, including already prepared future days.
The manager never starts a day or rewrites its Most Important, Commitments, To-dos, or Reminders lists.
