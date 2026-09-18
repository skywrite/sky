---
created: 2026-09-17
updated: 2026-09-18
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
  yes/no question. Before anything has been read: does answering this
  need the person's own notebook at all? After a reading, when the model
  still holds what it read: does this need anything more from the
  notebook than the conversation already has? The answer is a
  probability. Under `SKIP_BELOW` (0.2) the turn skips the reading; at or
  over it, the turn reads as it always has. The line sits low on purpose:
  a wrong skip answers without the notebook, a wrong read costs what
  every turn costs today. The verdict records which question was asked.
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

## The first day, and the second question

The first day ran one question for every turn — does answering this need
the notebook at all — whose criteria said a follow-up continuing
notebook work still needs it. In a thread about the person's people and
messages that is nearly always a yes: of 36 verdicts on 2026-09-17, four
skipped and 32 read, with 22 judged between 20 and 50 percent — "yep,
draft it" at 57, "spell it out" at 46, "send to slack" at 38. The
question was wrong for follow-ups. A skipped later turn keeps the last
assembly anyway, so from 2026-09-18 a turn after a reading is asked
whether it needs anything more from the notebook, with confirm, draft,
send, edit, and explain named as no, and a new person, record, message,
or a look at the notebook named as yes. The first turn keeps the
original question, and each verdict says which one it answered.

## Rules

- The check is a saving, never a gate. Anything that goes wrong reads.
- Jev sees the message and the recent turns, never the notebook.
- The verdict is recorded on every turn it ran, skipped or not; that is
  the record to read before moving the line or gating anything else on
  it.

## Verified

- 2026-09-18 — the second question: `preflight_test.ts` asks the
  needs-notebook question with nothing assembled and the needs-more
  question after a reading, and the verdict names the question;
  `ChatSession/mod_test.ts` tells the judge an assembly exists only
  from the turn after the first reading; the log round-trips the
  question. Live (a temporary Haiku thread): "What is on my calendar
  this week?" read at 98%; "Make that shorter." skipped at 7% in 1.5 s
  with the assembly kept; "Yep, draft a short note about it for me."
  skipped at 16%; "Did anyone message me about the first one?" read at
  85% and grew the context. The follow-up checks took about 145 ms.

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
