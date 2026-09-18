---
created: 2026-09-08
updated: 2026-09-08
---

# Hide deletion notices or permanently remove deleted work

Recoverable deletion kept showing old Undo banners above the canvas. Refreshing
the app restored those notices, and expanding the history used more space for
work that was already gone. Preserving a recovery option had become persistent
visual clutter.

The canvas now shows one notice. Hide dismisses all current deletion notices in
this browser; a compact Deleted work button retains access to Restore and Delete
permanently. Dismissal records the deletion event so restoring and deleting the
same workstream later still shows the new Undo opportunity.

Permanent deletion requires a separate confirmation and the current deletion
receipt. It removes the brief and positively owned supporting files rather than
recursively removing a folder: a person can move files, share sources, or nest
other workstreams there. Related work and daily/Outbox history survive. Minimal
hidden receipts reserve identities and reject old creation requests after the
content is removed. An interrupted cleanup can be retried with its original
receipt; newer file contents are preserved instead of silently discarded.

Both the deleted-work list and confirmation reuse Sky's dialog styles, with a
bottom sheet on phones. Hiding does not edit notebook content or restore Sky
responsibility; permanent deletion cannot be undone.
