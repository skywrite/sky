---
created: 2026-09-06
updated: 2026-09-06
---

# The chip names its subject at call time

## The problem

A tool's chip on the chat page says what the call was about — `web search
· atlas roadmap reviews` — from the model's record of the call. The engine
emits that record when the model's step ends, which for a command-backed
tool is after the tool has run and its run has folded. So a running
mission's chip reads `google agent · 2m` with no mission named until it is
over, and then the fold shows what it did instead.

## The shape of the fix

Emit the call when the model finishes composing it, before the tool runs.
The AI SDK's stream carries a tool-call part at that moment; the engine
would hook it and emit `tool-call` there instead of at step end. The
engine is shared with the terminal host, whose scripted tests drive tool
calls through the step-end hook, so both the terminal's line and the
engine tests move with it.

## What it trades

A change in the shared engine for a page-only gain, and the terminal
prints its tool line earlier. Small once the hook is placed.
