---
created: 2026-09-05
updated: 2026-09-05
---

# One clock for every agent

Comparing notebook research models exposed a measurement gap. Commands had
total durations, and Google missions had a stream-observing timer, but
research could not distinguish model requests from notebook reads. Its
`markdown:sel` duration also excluded document loading and context assembly
after the query returned.

The Google timer inferred generation from `start-step` to `tool-call`.
That boundary cannot represent streaming model/tool overlap reliably, and
summed tool durations inflate wall time when calls run in parallel. Moving
that observer unchanged would spread the same ambiguity to every agent.

The installed AI SDK has global execution hooks for model requests and
tools. The shared integration uses those hooks and carries a parent span
through the actual tool body. For a synthetic `ai:research` call, the tree
now includes its model requests, `notebook_query`, the nested `markdown:sel`,
and the remainder of query execution. An inner model call is a child of the
tool that asked for it.

One subtlety: the model execution hook returns a stream as soon as headers
arrive. Its promise duration alone misses most generation. The wrapper
therefore observes the returned provider stream through finish, error,
premature EOF, or cancellation, forwarding the original behavior unchanged.

Summaries use unions of time intervals. They remove a tool's own nested
model intervals before computing tool activity, and report independently
overlapping model/tool activity explicitly. This keeps the displayed wall
time meaningful while preserving inclusive durations for individual calls.

Tests exercise actual SDK loops with synthetic models, nested commands and
model calls, retried requests, unsuccessful tools, streamed failures, and
cancellation. Separate fake-clock tests cover overlapping work and nested
attribution; persistence tests verify that result contents never enter logs.
