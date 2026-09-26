# 2026-09-26 — late entries go in date order

## Problem

`appendRecordContents` always wrote the new row at the end of the file.
Logging today first and yesterday second left the two days reversed:

```
2026-08-16, 5:00, 39
2026-08-23, 5:25, 38.5
2026-08-17, 5:10, 38.8
```

A hand edit would have put the late day in its slot. Both `track:ask` and
the web tracking page write through this function, so both had the problem.

## Fix

The row goes after the last row on or before its date. The scan starts at
the end of the file and walks up past later days only. A file already in
order grows at the bottom as before. A late entry slots in above the later
days:

```
2026-08-16, 5:00, 39
2026-08-17, 5:10, 38.8
2026-08-23, 5:25, 38.5
```

A second entry for the same day goes after the first, so same-day rows keep
arrival order. Weekly files order by day letter (`M` … `SU`). Existing rows
are never moved, even when they are already out of order.

`appendRecord` now returns the row it wrote. Before, it returned the file's
last line, which is a different row after an insert.

The web page's display keys come from the row text, so an insert does not
disturb rows already on screen.

Tests: `lib/records_test.ts` covers an earlier day, an out-of-order tail,
a same-day second entry, a newest day without a final newline, and a weekly
file in the quoted era.

## Not changed

Changing an existing entry's date on the web page within the same year edits
the row in place. The row keeps its old position.
