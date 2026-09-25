---
created: 2026-09-23
updated: 2026-09-23
---

# The Google agent's records get their own folder

`google:agent` files one record per mission that touched a Google Doc, Slides
deck or Sheet: the files it touched, its report, its timing. Those records
lived under a day's `actions/docs/`, the only writer that folder had.

`docs/` is now reserved for the person's own documents: a report they worked
on, with the span of time it took, the file it produced and a summary of
what it says. That kind is designed and not yet built. The agent's records
are provenance for sky's work, not documents of the person's, so they move
out of the way: the kind is `googleDoc` in `ACTION_KIND_DIRS`, and its folder
is `google-docs/`. Docs, Slides and Sheets share it as before, told apart by
the medium tag in the file name.

The rename is the one-entry change the kind table was made for. The records
already in a notebook move in a rename-only commit, with the paths that
chat context logs and day summaries quote rewritten first. Until that move,
a notebook's old records sit in a folder nothing reads as a kind.
