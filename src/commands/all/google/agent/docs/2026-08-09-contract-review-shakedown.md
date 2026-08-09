---
status: shipped
created: 2026-08-09
updated: 2026-08-09
---

# Four ways a long review mission died before leaving a comment

The first full-length `legal:review` missions — a multi-page contract PDF
imported as a Doc, reviewed with anchored comments — failed four times in a
row, each time differently, before completing. Every failure produced a fix
that is now load-bearing (`ac8f691`, `b81d270`, `3ebc2b7`, `2edb05e`), and
two of the four went through a wrong theory first. Recorded here because the
final code makes the fixes look obvious while the diagnosis was not.

All examples below are synthetic (`Atlas MSA`); sizes are stated relative to
code constants, not real documents.

## Run 1 — aborted at 4 minutes of stream silence

The mission read the imported Doc, inspected it, rendered its pages, then
the stream went silent and the 4-minute watchdog killed the mission.

**Wrong theory:** payload explosion — "rendering pages stuffed dozens of
images into the context and the next request choked." Killed by reading
`inspect_doc_visually`: it exports the Doc to PDF and shows it to a
*separate* vision call, returning only a text critique. The mission context
was modest.

**What shipped** (`ac8f691`): the transport was the suspect that fit —
Bun's fetch timeout is deliberately disabled for long AI calls, so a socket
that dies without erroring hangs forever. `idleGuardFetch.ts` now guards
streaming requests only (non-streaming calls are legitimately silent for
minutes): 90s of network silence aborts the attempt; before any response
has arrived the request is re-issued invisibly (up to 3 tries), mid-body it
fails fast. Correct and still valuable — but runs 3–4 proved it wasn't this
run's actual killer.

## Run 2 — the mission ended by announcing its next step

The whole "report" was one sentence: *"The document is truncated in text
form. Let me get the structure and read the remaining pages visually."*
Then nothing. Two defects compounding:

- **`read_file` was a dead end past 40k chars.** The export exceeded
  `READ_LIMIT_CHARS`; the tool returned the first 40k with a bare
  `[Truncated]` marker, no way to get the rest — and the progress line
  printed the export's *full* length, implying a complete read. The
  reviewer had the front half of a contract whose exit and dispute clauses
  live in the back half.
- **Narration-quit.** In a multi-step loop, a turn of plain text with no
  tool call *is* the final report. The model announced a plan instead of
  calling a tool, and the harness took the announcement as the report.

**What shipped** (`b81d270`): `read_file` takes `offset` and a truncated
page ends with a self-directing marker naming the total and the next
offset; the log line became honest (`first 40000 returned`). The agent
prompt's Discipline section now opens with the narration ban: prose comes
once, at the end.

## Run 3 — aborted at 6 minutes of "silence" that wasn't

Pagination worked (the marker-guided reads covered the whole document),
then the stream went visibly silent at the first big-think moment — and stayed silent past the
(by then) 6-minute watchdog. Deterministic: same spot on re-run.

**Wrong theory:** the wedged-socket story again — it's what the watchdog
was built for. Three pieces of evidence killed it: the idle guard logged
nothing (bytes were flowing), the silence recurred at exactly the
same point (wedges are random), and the next run survived an identical
silent stretch and went on to work. **Real cause:** deep thinking streams
no visible parts for minutes; only keep-alive pings prove life. The
watchdog counted visible parts — it was measuring the wrong layer, and it
executed a healthy mission mid-think.

**What shipped** (`3ebc2b7`): `includeRawChunks: true` feeds raw SSE
frames — pings included — to the watchdog, which now starves only when
even pings stop (a state the idle guard has usually already converted into
an error). A heartbeat line prints every 2 minutes of visible quiet, and a
watchdog abort logs the last visible event plus the raw-frame count after
it: the dead-transport-versus-killed-think discriminator this diagnosis
lacked. (The first stall's log entry was also lost to a fire-and-forget
write — it is awaited now.)

## Run 4 — one comment placed, then five browser timeouts in a row

The think survived, analysis completed, the first anchored comment landed —
then five consecutive browser tool calls timed out and the mission reported
what it couldn't place.

**Cause chain:** every browser flow did launch → work → close on the
persistent profile. A rapid relaunch immediately after a close can wedge
Chromium's singleton negotiation outright; the launch *hangs* rather than
fails. Flows queue strictly one behind another, and the 180s tool timer
races a flow but does not cancel it — so the wedged flow kept holding the
queue while every queued call timed out in turn. One wedge, five failures.

**What shipped** (`2edb05e`): the browser stays **warm** between flows —
one launch per mission, idle-closed 90s after the last call — removing the
relaunch boundary that wedges (and ~20s of overhead per comment). Around
the launches that remain: a 60s launch bound; on a wedge, SIGKILL the
holder only after `ps` proves it is our profile's *headless* Chromium
(the visible sign-in window can never match); and a 150s flow deadline
that closes the browser out from under a wedged page operation so the
queue advances at the cost of one failed call.

## Open

- A mid-body transport idle now fails the mission fast instead of hanging
  it — but the mission does not *resume*. Restarting re-derives the whole
  analysis. Mission resume is future work if this bites.
- The warm-browser lifecycle has no unit tests (house norm for browser
  glue); the live e2e suite and real missions are its test bed.
- The severity ladder above (launch < idle guard < flow < tool < watchdog)
  is documented in [README.md](README.md) — keep it true when touching any
  of the constants.
