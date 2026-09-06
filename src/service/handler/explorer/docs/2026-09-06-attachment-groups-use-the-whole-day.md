---
created: 2026-09-06
updated: 2026-09-06
---

# Attachment groups use the whole day

The Add files picker initially grouped by the current document's
`attachments:`. A recording referenced by another meeting in the same day
therefore appeared under Not Attached, burying files no document had claimed.

For day documents, the picker now uses the same `readListing` call as the
day's Files page. Its `listedBy` marks come from reading every note in the
day, including notes in subdirectories. A mark puts a file under Attached;
the current document's local attachment list also counts, so a recent
addition need not wait for autosave.

Grouping and selection answer different questions. A file referenced by
another note belongs under Attached but can still be added to this note.
Only a file already in this document's local attachment list is checked
and disabled. The referring note's title appears below files attached
elsewhere. A document outside the day structure continues to use its own
attachment list and the existing directory listing.
