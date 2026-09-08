---
created: 2026-09-08
updated: 2026-09-08
---

# Place references need records and one identity

A reference such as `places/FR` could appear in a note without any country
record. The place store indexed only files, while the place creation commands
assumed venues with coordinates. No file meant no picker result or resolved
target. Separately, the web picker wrote display names while the store resolved
only place paths. The picker could render its own saved name, masking the
failure of backlinks and context traversal to follow it.

Creating a country file alone would repair the missing target but leave the
next UI selection broken. Adding name lookup alone would make same-named venues
depend on scan order: the old name index retained only one of them.

Place records now carry a logical ref independent of the display name, with
file-derived refs retained for existing files. Search iterates records, while
name and reference indexes retain all claims and resolve only unique matches.
The picker saves refs; legacy names and former refs remain readable. Minimal
geographic records use the same store and work without coordinates.

Repair deliberately materializes only recognized explicit country references.
A missing arbitrary path does not establish a geographic kind or an identity.
Those references remain visible for explicit creation instead of becoming
plausible-looking records. Exclusive writes preserve existing notes on repeats.
