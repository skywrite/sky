---
created: 2026-09-06
updated: 2026-09-06
---

# Links across an import

A video import could only acquire a reference by editing its frontmatter
after filing. The import dialog and review page offered no way to connect
the new recording to an earlier video, meeting, message or chat.

The shared picker offers recent records, type/date filters, search and a
preview. Titles describe the record rather than its on-disk filename.
Branch results show the parent and split point so a specific conversation
can be selected.

Two details are easy to miss. A picker must write a reference the notebook
resolver understands: a root-relative time-tree path is suitable for web
navigation, but the existing resolver expects a date and day-relative
subpath. The picker keeps these as separate `path` and `value` fields.

Also, the command owns the result until it finishes. Explicit selections
live on the persisted import job and merge into the result afterward.
Serializing this handoff with link edits ensures a selection arriving as
filing finishes is written regardless of which request arrives first.
A failure at this stage reports that the record was filed and offers to
retry its links; restarting the command could create a duplicate record.

Tests use synthetic Atlas records, including a nested chat branch. They
check durable references, reverse navigation, preserved content and the
browser flow before, during and after import.
