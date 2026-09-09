---
created: 2026-09-08
updated: 2026-09-09
---

# Tracking in the web app

`TrackingStore` composes the existing markdown definitions, CSV readers, and
capture parser into the web workflow. Today offers short check-ins;
`/tracking` owns history, corrections, setup, archive, and export. The CLI
[tracking contract](../../../commands/all/track/docs/README.md) owns the
definition schema, record formats, and date interpretation.

## Calendar date and review

Today's tracking uses `currentMoment(timeDir)`, the notebook's calendar date
and wall time. The notebook's open day can still be yesterday. Never derive
a new observation's date from the surrounding DayView. An explicit dated
page requests that date; an ended dated page shows its records read-only.

Sentence interpretation is a separate, non-writing request using the same
parser as CLI capture. The review exposes the exact date and declared values.
An unresolved date stays empty and prevents saving. Fields remain usable
without a model. Discuss with Sky prepares a composer draft containing the
selected range and sources; the person still sends it.

## Shared files and corrections

Definitions are loaded from disk for each request. Their content hashes guard
setup and capture forms against external schema changes. A setup form keeps
the revision it opened with while background reports refresh.

Every row has a mutation token incorporating its file's content hash and
physical line. Identical observations stay distinct. Any intervening edit or
append invalidates old mutation tokens. A separate display key uses the raw
row and its occurrence number so polling or appending does not replace
unchanged DOM rows or destroy browser text selection.

CSV header names own positions. Appends and corrections retain older columns,
align reordered definitions by name, and extend headers for added answers.
Existing rows keep their bytes unless explicitly edited or deleted. Once
records exist, setup cannot remove answers or change their names, types, or
units, which would reinterpret history. The definition slug remains the join
key even when its displayed title changes. Annual files remain authoritative
over legacy weekly shards, including empty annual files.

Missing and nonnumeric values never become zero. Charts preserve daily gaps
and apply each column's declared aggregation; the table retains individual
observations. Range averages use days with recorded numeric values, including
explicit zeroes. Cumulative metrics retain their total and show the daily
average alongside it. Duration capture converts explicit hours/minutes to the
declared storage unit before writing.

All time discovers existing annual and supported legacy week files once per
report, then derives the range from recorded dates. Definition start dates and
fixed lookback cutoffs must not exclude earlier observations. Empty annual
files still supersede their legacy year's rows. All-time exports use the same
reader as the charts; an empty history is anchored to today.

## Conflicts, retries, and interrupted writes

CLI appends and web mutations share per-file process locks in the machine's
temporary directory. A browser mutation first checks its expected snapshots
under those locks. A conflicting external edit returns 409, with no overwrite.
Writes use a temporary file and atomic rename.

The service's local user-data directory holds operation receipts and a pending
transaction journal. Cross-file date changes and archive moves journal every
before/after snapshot before changing the notebook. The next operation finishes
an interrupted transaction only when every affected file matches either its
before or after state; an independent edit stops recovery with a conflict.

Each form retains an operation ID across network retries of the same payload.
Receipts prevent duplicate writes and support exact Undo. Undo validates all
current snapshots before restoring anything, so it cannot erase intervening
work. Receipts are local recovery state; notebook definitions and CSV files
remain the authoritative user data.
