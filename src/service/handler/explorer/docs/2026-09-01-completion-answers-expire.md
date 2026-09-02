---
created: 2026-09-01
updated: 2026-09-01
---

# Completion answers expire

## What was seen

A suggestion in the who field carried a "weeks ago" hint for a person the
service, asked directly at the same moment, placed days ago.

## Why

`complete.ts` cached every completion answer by its URL and every resolved
name for as long as the page lived. The one function that forgot them had no
caller. A page left open through a day's captures kept answering from the
notebook as it was when the letters were first typed.

## What changed

Each cached answer carries the time it was remembered and stands in for ten
seconds — a burst of typing on one field. After that the same letters ask the
service again. The forgetting function, unused, is gone.

## Verified

Typecheck and lint; the panel's unit tests. Live: typing a name, waiting past
the window, and typing it again fetches a fresh answer.
