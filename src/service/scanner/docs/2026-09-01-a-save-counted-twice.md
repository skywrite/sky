---
created: 2026-09-01
updated: 2026-09-01
---

# A save counted twice

## What was seen

A person's score dropped by a few percent across a service restart, with no
notebook change to explain it. The scores between boots were higher than the
files on disk warrant.

## Why

The watcher hands every saved file to `processFileUpdate`, which runs the same
readers as the boot scan. The readers only ever add: each save recorded the
file's interactions again on top of the last time, so a meeting edited five
times scored as five meetings until the next boot rebuilt everything from
disk. Removed files kept their share until the entity rebuild that removals
schedule.

## What changed

- `ScoringStore` keeps what each source contributed — kind, name, date,
  points — and `forgetSource(file)` takes it back: scores and counts come down
  by the file's share, a last date is found again among what remains, an
  entry with nothing left goes. `replaceFrom` carries the ledger across a
  rebuild.
- Every reader passes the file it reads as the source; the project reader
  gained the file argument it lacked.
- `processFileUpdate` forgets the file before reading it. The watcher forgets
  a removed file at once, and still schedules the roster rebuild.

## Verified

Unit: `ScoringStore` (a source forgotten and read again leaves the score as
after the first read; forgetting the file with the latest date finds the
earlier one and drops what the file alone carried), scanner (a time file read
again after a save counts once; a file saved three times through
`processFileUpdate` scores its attendee for one meeting and its tag for one
file). Typecheck, lint, and the full unit suite.
