---
created: 2026-09-05
updated: 2026-09-05
---

# The usage meter

## What happened

Nothing in Sky read the token counts a model call returns. The error log
kept failures, the service log kept timings, and the bill arrived as one
number. Measuring where the money went meant estimating from saved chats:
about 300k tokens of context per turn, rebuilt on most turns, the cache
almost never read. A cache fix could not be seen working from the product.

## What changed

- **Every call is recorded.** `resolveProfile` wraps each model in
  `usageMeter`, a middleware that appends one line to
  `<userDataDir>/logs/ai-usage.jsonl` per call: the stamp, the command
  making the call, provider and model, and the four counts the invoice
  bills — full-rate input, input read from the cache, input written to it,
  output. A generation records when it returns; a stream as its finish part
  passes. No call site has to remember.
- **The command is the source.** `runWithUsageSource` carries a name across
  awaits; the command service sets it for every command it runs, the CLI
  runner for the top-level one, the chat routes for a turn. A mission
  called as a chat tool records as `google:agent`; the chat's own calls as
  `ai:chat`; a call outside any command as `cli` or `service`.
- **Every turn shows its counts.** The chat engine sums the SDK's usage over
  a turn's steps and approval rounds into `TurnResult.usage`; the session
  carries it on the turn report and writes it to the turn's context-log
  entry (`usage`, additive), so a saved chat keeps it. The web page shows
  one dim line under each reply — `312k in · 298k from cache · 4.1k out ·
  Claude Opus 5` — and the terminal prints the same after each reply.
- **`sky ai:usage` rolls the day up**, by model and by command: calls, the
  four counts, and the share of everything read that the cache served.
  `--days N` widens the window.

Tokens only. Dollars need a price per model, which is a table to maintain;
tokens by model are what the invoice is computed from, and the cache share
is the number that says whether a caching change worked.

## Verified

Unit tests on the counts, the line, the middleware (generation and stream,
source nesting), the engine's summing across rounds, the route's frame and
read-back, and the rollup. Live on the page and in the terminal: see the
chat README's verified list.
