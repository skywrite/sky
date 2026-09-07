---
created: 2026-09-06
updated: 2026-09-06
---

# A turn that stops says so

A chat asked for a Google Doc: research this weekend's results, then build
it with tabs. The reply was one sentence, "I'll pull this weekend's results
first, then build the doc", a sources list, and nothing else. No error, no
pending approval, twelve web tool runs, no doc. The turn had made exactly
five model calls: the engine's default step cap, which nothing in the web
chat raises. The model spent all five on research and would have called
the agent on the sixth. The engine never looked at how the last step ended,
so the cut was indistinguishable from a finished reply.

## What was built

- **The closing step.** When the loop is ended by the engine and not by
  the model, the model gets one more step. Its last message is a notice
  from Sky — the reason (`This turn has used its 40 tool steps.` or the
  repeated-call reason) and the ask: do not call tools, say in a few short
  lines what was done, what was found, what is left, and that "continue"
  carries on. The notice is prompt only; response messages never carry it,
  so the next turn's history is clean. Its text is the reply's last
  paragraph. The tools stay defined: this SDK's Anthropic provider drops
  the tool definitions for a tool choice of none, and Anthropic rejects a
  history of tool calls with no tools. If the model calls tools anyway and
  writes nothing, the engine writes a fixed closing line. The `stopWhen`
  array holds the cap plus one and a condition that ends the loop after
  the closing step.
- The first placement was a line appended to the system prompt. Live, a
  model that had been told by the person to write nothing until done
  ignored it and called a sixth tool; the fixed line carried the turn. The
  system block also invalidated the prompt cache for the step, so that one
  call re-wrote the whole conversation. A message after the tool results
  is what the model reads last, and leaves the cached prefix intact.
- **`cutShort`** on the turn result and the session report: `steps` or
  `repetition`. The CLI prints a dim line from it. The page needs nothing —
  the closing text streams as the reply.
- **The repetition guard** (`ChatEngine/repetitionGuard.ts`). Same tool,
  same input, same result: the second identical result is annotated, the
  third identical call is refused unrun, three refusals exhaust the guard
  and the closing step ends the turn. Inputs are canonical JSON, results
  are compared whole. `guardTools` copies the tool set, so a host that
  hands the same tools to every turn gets a fresh guard each turn.
- The Google agent's mission tools sit behind the same guard, outermost
  around the timeout wrapper, with a feed line per refusal. The agent's
  own step cap ends a mission; the guard only removes the wasted calls.
- **The cap moves from 5 to 40.** With the guard catching loops and the
  closing step making any stop legible, a count of five only cut honest
  turns. Forty is a backstop no chat turn should reach, kept because the
  guard sees one loop shape only — a call whose result never repeats,
  a timestamp in an error, a reworded search each time — and the page has
  no Stop control yet: a runaway with no ceiling could only be ended by
  restarting the service. The bound that should replace the count is
  spend per turn, from the usage meter; that is proposed, not built.

## Rules

- A turn the engine ends is never silent. The model says where it stopped,
  or the engine does.
- Only an identical result makes a repeat. A re-read after a write is work,
  not a loop.
- The cap counts tool steps; the closing step is one past it and only
  happens when the loop was still calling tools.
- The guard changes what a tool returns, never what a tool does: a refused
  call does not run.

## Verified

- `repetitionGuard_test.ts` — the ladder over five identical calls (run,
  run with note, three refusals, exhausted); a changed result restarts the
  count; other inputs stay apart; key order does not matter; array and
  object results are annotated in their own shapes; the set is copied.
- `mod_test.ts`, driving the real SDK loop with a mock model — a two-step
  cap gets a third step whose text is the reply, whose prompt carries the
  reason line, and whose tools are still defined; a closing step that
  calls tools anyway ends with the fixed line; five identical calls under
  a cap of ten run two, refuse three and close on the sixth call, flagged
  as repetition; a turn the model finishes carries no flag.
- `tools_test.ts` (agent) — three identical Drive searches: two requests,
  a note on the second, a refusal and a feed line on the third.
- Live, first placement (system line): six sequential tool calls under
  the cap of five — five ran as steps, the sixth call became the closing
  step, the model called the tool anyway, and the reply was the fixed
  line. The cache read for that step fell to the system prompt alone.
- Live, notice as the last message, on a fast model with the notebook
  closed: the same six-call ask ran five tool steps, and the closing step
  wrote the reply — five of six dates done, the sixth and the counts left,
  "say continue". The closing call read the whole conversation from cache
  and wrote only the notice. A five-identical-calls ask ran two, saw the
  note on the second, was refused on the third, and the model stopped by
  itself and explained the refusal; no closing step was needed.
