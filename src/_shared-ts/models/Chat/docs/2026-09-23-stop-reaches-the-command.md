---
created: 2026-09-23
updated: 2026-09-23
---

# Stop reaches the command

A web chat asked for advice on answering a Slack thread. The model called
`slack_unread` with a per-channel limit and nothing else. The command's
scan cap defaulted to *all*, so it walked every conversation in the
workspace, one Slack call each, at Slack's rate. The person pressed Stop
after fifteen minutes. The button read "Stopping response…" and stayed
that way for ten more. Nothing was broken: the engine had aborted the
model at once and was waiting for the running tool to settle, as it does
for every tool, because a tool that writes may be mid-write. The command
never saw the Stop. Its signal ended at the chat wrapper.

## What was built

- **The signal rides into the command.** The AI SDK hands each tool call
  the turn's abort signal. `runToolCommand` now runs the command on a
  scope forked with it — `CommandService.withSignal` — so the command
  reads it as `context.signal`, and every command it composes inherits
  it. A signal the scope already carried still counts; either aborting
  aborts the run.
- **The scan checks per conversation.** `slack:unread` reads its signal
  before each Slack call in the scan, in the conversation listing and in
  the search-hint pass, and returns `Stopped`. A Stop lands within one
  call.
- **The scan is bounded by default.** Forty conversations, most recent
  first. `--max 0` scans all. The activity line says how many of how many, "40 of 900".
- **The page names the wait.** While a Stop waits on a running tool, the
  run's chip reads Stopping, its status line says the reply ends when the
  run does, and the Stop button's label names the tool.

## What was not built

The engine keeps waiting for a running tool to settle. A read-only
"abandon the turn" path was considered and ruled out: a tool that hangs
on Stop is a tool missing its one-line check, and the fix belongs in that
command. A per-tool time budget for chat tools is a separate decision.

## Limits

- A command that never reads its signal still holds a Stop until it ends
  on its own. The page now says which one.
- Voice runs the same commands but has no Stop control yet, so it passes
  no signal.
