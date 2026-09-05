---
created: 2026-09-05
updated: 2026-09-05
---

# Timing is collected, not requested

The first shared timing implementation included a diagnostic CLI viewer.
That was the wrong interface emphasis: performance history must accumulate
from ordinary web and CLI use without a person knowing instrumentation exists.
The viewer was removed; collection and durable traces remain automatic.

Each log record identifies its host (`cli` or `service`) and schema version.
Individual completed tool and command spans preserve the samples needed for
latency distributions over time. Starts preserve evidence of interrupted work;
they are not successful calls or zero-duration samples. Nested model spans
explain why a tool is slow without double-counting its latency in a run total.

A web-route integration test exercises two replies, actual SDK tool execution,
and the shared command boundary. It reads the daily files back and verifies
separate reply traces, one sample per call, names, durations, outcomes, model
metadata, and parent relationships. Prompt and result contents must stay out.
The test needs no telemetry option on the model or tool invocation.

This establishes the local history for identifying slow tools and comparing
changes. Detection thresholds, scheduled analysis, and optimization decisions
remain separate work; collection does not depend on building those surfaces.
