---
created: 2026-09-05
updated: 2026-09-05
---

# Annual tracking needs a migration and a complete capture loop

Annual storage already existed as an opt-in for sparse measurements, while
daily tracking still wrote weekly shards. Moving the files alone would leave
week creation minting new shards and summaries reading the retired locations.
Annual storage is now the default, week creation stops copying CSV templates,
and health summaries, checkins, and exports use the annual reader.

Historical CSVs are not one fixed schema. A synthetic hydration series might
begin with `day,amount`, later add `time` before `amount`, and eventually add
notes. Positional concatenation would silently put old measurements into the
time column. The migration instead aligns named columns to the definition,
retains additional historical columns, and reports undeclared overflow fields.

The week directory's year is not necessarily the row's year. A boundary shard
can contain the whole Monday–Sunday week even when its directory represents
only one year's bucket. Date conversion uses the true Monday and files each
row by its resolved date, retaining extended hours without normalization.

Set-based deduplication would erase legitimate repeated measurements. Existing
annual rows instead cover legacy rows as a multiset: each existing occurrence
can cover one identical legacy occurrence. This also makes recovery after a
partly completed execution possible without appending the same history again.

Historical hand edits sometimes contain broken quoting. General multiline CSV
parsing can swallow the next observation into an unfinished quoted cell. Tracking
has always used physical lines as records, so the migration preserves that
boundary, reports terminal quote repairs, and requires explicit exact-line
repairs for ambiguous interior quotes. All originals are backed up before writing.

Validation covers column evolution, duplicate observations, year boundaries,
extended hours, existing annual data, capture after migration, backup fidelity,
stale-plan refusal, and an unchanged rerun.
