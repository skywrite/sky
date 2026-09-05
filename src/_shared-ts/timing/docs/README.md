---
created: 2026-09-05
updated: 2026-09-05
---

# Timing commands, model requests, and tools

`mod.ts` owns a trace and its nested spans. `AsyncLocalStorage` carries the
parent through asynchronous and parallel work. Durations use the monotonic
`performance.now()` clock. Spans also carry real UTC `startedAt`/`finishedAt`
timestamps with seconds and milliseconds, from nbdt's Temporal-backed
`instantNow()`. Elapsed time never comes from subtracting wall-clock stamps.
Timing never records inputs, prompts, results, or error messages, and a
failed sink never changes the operation it observes.

## Boundaries

- The CLI invocation opens before command loading and closes at process exit.
  `CommandService.run()` times every dispatched command, including nested calls.
- A chat reply has its own trace, separate from idle time between messages.
  The web trace begins when the server accepts a valid prompt, before thread
  construction, `session.start()`, and initial context loading. In the CLI it
  begins at `ChatSession.send()`, after the prompt is submitted. Both end when
  the result is ready, including gathering, model/tool work, and approval waits.
  Saving that finished measurement is outside the prompt-to-result duration:
  it cannot include the write of its own final duration. Browser transit and
  rendering, and later save-time enrichment, are outside this boundary too.
- `ChatEngine` and the Google mission each have a generation span. Research
  uses the same engine as chat; no research-specific tool wrappers are needed.
- `sdk.ts` installs one global AI SDK telemetry integration. Its execution
  hooks time every language-model request attempt and every executable tool.
  Tool bodies run in the tool span's scope, so a nested command or agent
  inherits the correct parent. Global installation is idempotent; per-call
  SDK telemetry overrides can replace it deliberately.
- A streaming request stays open through the provider's finish event. Receipt
  of response headers does not finish it. Stream errors and cancellation
  retain their original behavior and close the span. An EOF without a finish
  is incomplete. First output includes reasoning and streamed tool arguments.
- SDK retry attempts have step and attempt numbers. Backoff between attempts
  is in other time. A provider's internal retries remain within its attempt.
  Provider-executed tools remain part of the model request; there is no local
  tool execution boundary to measure separately.

## Reading the numbers

`summary.ts` computes interval unions, not sums of nested durations:

- `wallMs`: elapsed time of the selected run.
- `modelMs`: wall time with at least one model request active.
- `toolMs`: wall time with a tool executing, excluding that tool's own nested
  model requests. A research agent invoked as a tool does not count all its
  thinking as tool execution.
- `overlapMs`: independent model and tool work running at the same time.
- `otherMs`: time covered by neither, including preparation, retry backoff,
  approvals, and persistence inside the selected run. Engine approval waits
  also have their own spans.

The identity is `wall = model + tools - overlap + other`. Per-tool and
per-model rows are inclusive totals across calls; those rows can overlap
and must not be summed to recover wall time. Model rows include token usage.

## Persistence and surfaces

CLI and service entry points enable `log.ts`, appending start/end records to
`<userDataDir>/logs/timing/YYYY-MM-DD.jsonl`. Small synchronous writes survive
CLI exit. Each record has a trace ID, span ID, optional parent ID, and safe
measurement metadata. An unmatched start survives a crash as an unfinished
span. Existing command logs and AI token-usage logs continue unchanged.

Collection is automatic, not a command or a consumer setting. Every record
also carries `version: 1`, `source: cli | service`, and a calendar timestamp.
Service records cover web replies and background commands. These diagnostic
records are local and durable; they do not contain notebook content or become
notebook documents. They survive page reloads and service restarts, regardless
of whether a chat transcript is kept.

For performance analysis, select `timing-end` records by `span.kind` and
`span.name`, then group durations by time window and source. Keep sample count,
mean, median, p95, and outcome counts: a faster average caused by early failures
is not an improvement. Model spans also carry provider/model, token usage,
first-output time when streamed, and retry attempt. Parent IDs let a slow tool
be traced into its nested commands and model requests. Tool durations are
inclusive latency per call, not the exclusive tool activity in a run summary.
Do not add enclosing commands and their tools together or count starts as
completed calls. Unmatched starts are unfinished, never zero-duration samples.
`read.ts` coalesces start/end pairs for offline trace analysis; a trace crossing
midnight may need records from multiple daily files.

This is the measurement history for later bottleneck detection and before/after
comparisons, not an automatic alerting or optimization system. No consumer has
to run a diagnostic command to produce it.

Every new chat turn stores an optional `timing` object beside `usage` in its
existing v2 `CONTEXT-LOG`. It is a `TimingDetail`: the summary, precise UTC
start/end stamps and outcome, individual `spans`, and `droppedSpans`. Each
span retains its name, IDs, parent, relative start, duration, outcome, and any
model/retry/token metadata. Repeated calls stay separate. `wallMs: 45250`
means 45.25 seconds from accepted prompt to result, even when both visible
transcript headings say the same minute. Old transcripts simply lack timing;
their minute stamps cannot reconstruct accurate historical durations.

The session freezes this detail before the first autosave. Save, resume, and
snapshot restoration carry it forward unchanged. Branches inherit the timing
of their prefix, but file only their own turns; parent records remain in the
parent file. Each turn is independently analyzable without the daily logs, up
to the trace cap below. `traceId`/`spanId` join it to the same central records;
do not count the chat copy and the central copy as separate samples.

Chat replies show a brief summary in the CLI and web UI. The web's displayed
summary is kept in the live thread; the saved structured history persists
independently of that UI cache. Research returns its engine timing alongside
its digest. Google missions retain their previous timing record shape, extended
with the shared trace ID and overlap/other measurements (`mission.ts`). The
command span also covers preparation and cleanup outside the generation.

Memory is bounded to 10,000 spans per active trace. A capped live summary is
marked incomplete; every span still reaches the log and can be reconstructed.
Late asynchronous work after its parent closes begins a new trace. Timings
cover this process; an external service's round trip is included in its tool
or command, without pretending to expose that service's internal work.

## Notes

- [2026-09-05 — timing belongs to the saved turn](2026-09-05-saved-turn-timing.md)
- [2026-09-05 — automatic performance history](2026-09-05-automatic-performance-history.md)
- [2026-09-05 — one clock for every agent](2026-09-05-one-clock-for-every-agent.md)
