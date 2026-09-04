---
created: 2026-09-03
updated: 2026-09-03
---

# The cache tail moves on every loop step

A tool loop (`streamText` with `stopWhen`) is one call from the caller's
side and many requests on the wire: after every tool call the SDK replays
the whole conversation and asks the model for the next step. Anthropic's
prompt cache only covers bytes **before** a breakpoint, and the loops set
breakpoints on the system prompt alone — so the replayed history sat after
the last breakpoint, and every step re-billed all of it at full price. The
bill for a mission grows with the square of its step count.

## The fix

`cacheTailStep` in `promptCache.ts` is a `prepareStep` hook: before each
model call it re-tails the message list with `withCacheTail`, which strips
the previous step's marker and marks the step's last message (usually the
tool result that closed it). Each request then reads everything before
that message from cache and writes only what the last step added. Both
loops pass it — `google/agent/mod.ts` and `ChatEngine`. The provider caps
breakpoints at four; the loops use two on instructions and one tail.

Verified live on 2026-09-03 with a synthetic probe against Opus 5: a
2.5k-token system prompt, one tool called three times, four steps.

| step | today: uncached / cache read | fixed: uncached / cache read / cache write |
|---|---|---|
| 1 | 110 / 0 (writes 2,474) | 2 / 2,474 / 108 |
| 2 | 646 / 2,474 | 2 / 2,582 / 536 |
| 3 | 1,182 / 2,474 | 2 / 3,118 / 536 |
| 4 | 1,718 / 2,474 | 2 / 3,654 / 536 |

Today the uncached column is the history, growing by a full step each
time; fixed, it is the two tokens of the request envelope, and the history
rides the cache-read column at a tenth of the price.

## What this does not touch

The chat context segment (the second instructions block ChatSession sends)
is rebuilt whenever the context pipeline changes the shipped documents.
Any byte change there invalidates every message after it, tail marker or
not — that is a context-layout question for ChatContext, recorded
separately, not a loop-caching one. A step that follows a long-running
tool can also outlive the five-minute cache window; the cache then
re-writes rather than reads, and the loop still works.

Tests: `promptCache_test.ts` (the helper) and `ChatEngine/mod_test.ts`
(the SDK loop over a mock model, asserting where the marker sits on each
request).
