---
created: 2026-09-17
updated: 2026-09-17
---

# Ask first whether a message needs the notebook

Every web chat turn reads the notebook: a query is derived from the
message, run, and the result assembled under the reading budget — three
hundred thousand tokens by default — before the model sees a word. That
is the bill's biggest line, and much of it goes to messages that never
needed it: a haiku, a rewrite of the last reply, a question any assistant
answers the same. The manual switch, "Reads nothing", was the first
answer (2026-09-02). This is the automatic one, behind an Experimental
switch, and it is the first thing in Sky that asks TypeSafe's Jev.

## What was built

- Settings → Experimental: "Jev preflight for notebook context", off by
  default, kept as `experimental.contextPreflight` in the config file. The service reads it fresh per message, so flipping
  it applies to the next one. It needs the TypeSafe key under
  Connections; without it, every check fails into the AI error log and
  the turn reads as usual.
- `ChatContext/preflight.ts` — the check. Jev gets the message and the
  last four turns, each trimmed to four hundred characters, and one
  yes/no question: does answering this need the person's own notebook?
  The answer is a probability. Under `SKIP_BELOW` (0.2) the turn skips
  the reading; at or over it, the turn reads as it always has. The line
  sits low on purpose: a wrong skip answers without the notebook, a wrong
  read costs what every turn costs today.
- `ChatSession`: the host passes a `preflight`; the session runs it
  before the reading, after the stamp. A skipped first turn tells the
  model outright that nothing was read for this message and why, never
  that the notebook is empty. A skipped later turn keeps the last
  assembly exactly as the model saw it — a follow-up keeps what the
  conversation was about, and the prompt prefix stays cached — and runs
  no query. The verdict goes on the turn's log entry either way, so a
  turn that read still says what the judge thought. A check that throws
  is logged under `context:preflight` and the turn reads as usual.
- The page: "answering without reading your notebook" while the model
  runs; the context story shows "Skipped reading" with the chance the
  judge gave, and a turn that read shows its chance under the entry.
  Every check is one line in the usage log under provider `typesafe`.

## Rules

- The check is a saving, never a gate. Anything that goes wrong reads.
- Jev sees the message and the recent turns, never the notebook.
- The verdict is recorded on every turn it ran, skipped or not; that is
  the record to read before moving the line or gating anything else on
  it.

## Verified

- Unit: `ChatSession/mod_test.ts` — a skip, a read, a skip, and a failed
  check in one thread: nothing read and the model told why; the gather
  on the second; the second assembly reused on the third with no
  producer call; the fourth reads as usual with the failure logged.
  `ChatContext/preflight_test.ts` — the state sent (message, turns as
  person/sky, trimmed), a 4% verdict skips, 91% and the line itself
  read. `timeline_test.ts` — a skipped turn's kind and verdict.
  `ContextLog/mod_test.ts` — the verdict serializes and reads back.
  `settingsRoute_test.ts` — the switch is read as a value and written
  as the words on and off.
- Live (2026-09-17, a temporary Haiku thread on the running service):
  "Write a haiku about rain." — judged 1% in 422 ms, skipped, answered in
  3.3 s with nothing read; the page said "answering without reading your
  notebook" and the story shows "Skipped reading". "What is on my calendar
  this week?" — judged 98% in 157 ms, read as usual (104 files kept) and
  answered from the notebook. Both checks landed in the usage log under
  `typesafe`.
