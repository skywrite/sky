# 2026-09-25 — bare cells end at the comma

## Problem

`formatField` wrote every number, time, and duration answer bare, trusting
the column type rather than the value. The web store validates each answer
first, so it could never hand the formatter a comma. The CLI's parsed path
does not: the model's values reach `formatRow` straight from
`sanitizeParsedValues`. A parsed `1,200` for a number column produced

```
M, 6:05, 1,200
```

four cells where three were meant, with `200` spilling into a new column
that the reader then reports as `extra_1`.

## Fix

A value carrying a comma or a quote is quoted whatever its column type.
Numbers and times still write bare; prose still writes quoted. The same row
now reads

```
M, 6:05, "1,200"
```

Tests: `lib/records_test.ts` covers the comma and quote cases and a parse
round trip through `readTrackingCsv`.

## Not changed

`track:migrate` still serializes annual files with every cell quoted
(`writeTrackingCsv`). Capture and the entry editor write the hand
convention, so a migrated notebook carries two quoting styles until its
history is rewritten. Sky reads both.
