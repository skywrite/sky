---
created: 2026-09-06
updated: 2026-09-06
---

# Project completion keeps its prefix

The Links field (`rel:`) included projects in its vocabulary, but used
their bare names as completion values. Typing `projects/` matched nothing.
Searching by name could find a project, but selecting it wrote a bare name
that the Markdown store could not resolve as a project.

Project completions now carry `projects/Name` as their value and the name
as their display label. Both participate in matching, so a name or a
`projects/` prefix finds the same project. The reference uses the overview's
name, independently of its physical directory: a project named Team Survey
under `projects/open/Widget-V2/_project/overview.md` saves as
`projects/Team Survey`. The existing resolver then links it to its overview.

The completed status is also recognized when sorting open projects ahead
of closed ones. Tests build projects in their current status/name/_project
layout; the older flat project fixtures do not enter the project store.

Regression coverage checks name and prefix matching, case-insensitive
search, ordering, the completion route's limit, and resolution of inserted
values. A browser test types the prefix in Links, chooses with Enter,
checks the saved YAML, and reloads to check the chip's destination.
