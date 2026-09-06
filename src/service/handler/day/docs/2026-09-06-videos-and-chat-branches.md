---
created: 2026-09-06
updated: 2026-09-06
---

# Videos and chat branches in the day

The day gather already read video documents, but the record builder had
no video case, so those files never reached the page. Saved chats were
visible only in Details. Both now have sections in the main day's record,
using the existing document rows and typography. A video's saved summary
names it because its H1 is usually just the platform, such as "Loom".

The chat list also had two depth limits: the store read only one folder
below the day's chat directory, and the rail rendered only immediate
children. A branch of "Atlas planning" could have its own branch on disk
and disappear from the list. Mixing live and saved parents caused more
gaps: the two lists resolved parents separately, and a stale live parent
id could prevent a branch from finding the parent's saved file.

The store now walks the whole chat directory. The day column and the rail
share one hierarchy that substitutes live continuations for their saved
rows, resolves parents by id or saved path, and visits every generation.
Each row appears once, including when hand-edited parent keys form a
cycle. A parent outside the day is named at the branch point. Branch
counts say "new turns" so inherited messages are not counted as new work.

Returning to the day triggers a fresh read, as do changes to the live chat
list and import state. A chat that finishes saving after navigation, or a
video filed while the day is open, appears without a browser reload. The
existing record stays visible while the refresh arrives.

Model and record tests cover nested files and video metadata. Client tests
cover mixed live and saved hierarchies, missing parents, and counts. A
browser test checks both day layouts, navigation back from a video, and a
saved parent becoming live without losing its descendants.
