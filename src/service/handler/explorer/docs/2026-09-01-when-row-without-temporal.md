---
created: 2026-09-01
updated: 2026-09-01
---

# The when row without Temporal

## What was seen

A page's `when` row said "not a date or a range" under a plain
`YYYY-MM-DD HH:MM` value in a headless run, while the same page in the
desktop browser read "Sun". Reading or editing made no difference.

## Why

The hint parses the value with nbdt's `When.fromYaml`, which expands the date
part through `expandToYMD`. That helper computed its reference day with the
global `Temporal` before checking whether any part was missing, so a full
date threw `ReferenceError` wherever the engine has no `Temporal` — Safari,
Firefox, older Chromium — and the hint reported a parse failure. The
service runs on Bun, where `Temporal` exists, so nothing on the command line
ever noticed.

## What changed

`expandToYMD` reads the reference day only when a part is missing, and reads
it the way the rest of nbdt does — the local calendar day from `new Date()` —
so no path needs `Temporal`. Whether the date is on the calendar is decided
by the month lengths and the leap-year rule, as `Temporal`'s reject overflow
did.

## Verified

Unit: the helper's tests, plus a full date expanded with `Temporal` removed
from the global scope. Live, headless in the older Chromium: the row reads
"Sun".
