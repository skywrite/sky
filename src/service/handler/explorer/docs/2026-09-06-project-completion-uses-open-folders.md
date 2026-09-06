---
created: 2026-09-06
updated: 2026-09-06
---

# Project completion uses open folders

The first prefix fix made projects searchable but kept using every indexed
project overview. Ranking completed projects later still offered them, and
the overview's name could differ from what our VS Code extension inserts.

`ProjectsCompletionItemProvider.ts` lists visible directories directly
inside `DIR_PROJECTS_OPEN`. It uses folder names, does not require an
overview, and stops when the text after `projects/` contains another slash.
The web now follows those rules. Both callers use
`#shared/nbfs/openProjectNames.ts` for directory selection. A project's
frontmatter status does not override its directory for completion.

The vocabulary still caches store-derived data by store version. Project
folders are listed on each request because creating or moving an empty
folder need not change that version. The web's existing brief request
cache still applies. Selecting `projects/Widget-V2` links to that folder's
overview when indexed, or to the folder itself otherwise. Historical
references outside open still resolve through the store.

Regression tests cover all other status directories, hidden folders,
ordinary files, nested overviews, missing overviews, folder names differing
from YAML names, conflicting YAML statuses, another slash, and a new empty
folder without a store update. The browser test asserts the entire offered
list before selecting, saving, and reloading the link.
