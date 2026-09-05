---
created: 2026-09-01
updated: 2026-09-05
---

# Chat over HTTP — a thread, its tuning, and the story of its context

Design notes for `src/service/handler/chat/` and the page that drives it,
`theme/client/chat.tsx` with `controls.tsx` and `context.tsx`.

## What is built

A thread is a ChatSession kept in memory for the life of the service. A
message is a POST whose response is the turn's event stream; the page
renders the same events the terminal renders. Around that, three things
a person can see and touch:

- **The model a thread thinks with and how much it reads.** Both sit under
  the composer, beside the files-in-context count: `Opus 5 ▾` opens the
  configurations from Settings › AI grouped by provider, with the role
  each one holds; `Reads up to 300k ▾` offers the reading budget in stops.
  Both apply from the next message. `GET /chat/:id/settings` answers the
  tuning — the thread's own, else what was chosen before its first
  message, else the host's defaults (the Thinking role, ai:chat's 300k).
  `POST /chat/:id/settings` with `{ profile?, contextTokens? }` changes it:
  a live thread swaps the model for its next turn and reassembles its
  context under a new budget at once; a thread not yet built keeps the
  choice for when its first message builds it. The first stop is
  **Nothing** (`contextTokens: 0`): the notebook stays closed. No baseline
  is gathered, no question is turned into queries, the model answers
  from the conversation and the tools it calls, and the context prompt
  says so outright rather than showing an empty activity block. The
  gather line reads "not reading your notebook", the files count leaves
  the strip, the Context panel says the notebook is closed, and each turn
  enters the story as "Notebook closed". A budget chosen later opens it:
  the next message gathers the baseline and runs as the first gathering
  turn, whose entry records the universe. The rule lives in the context
  model, and the terminal offers the same stop: `sky ai:chat --no-context`
  (or `--max-context 0`) starts closed, fetches nothing, and says so.
- **The context, turn by turn.** The Context panel opens with the story:
  the notebook read at the start (files found, how many fit),
  what a later question brought in, what the budget pushed out to make
  room, what the model read by tool, and the step under way while a reply
  is prepared. `GET /chat/:id/context` carries it as `log`, derived in
  `timeline.ts` from the session's context log — each entry ships only
  its change, never the universe again.
- **What the model sees now**, below the story, folded: every document in
  context with its tokens, what was left out and why, and the hand on it
  (pin, drop, let back, pin a file by path). As before.
- **A tool call that needs a go.** The page offers every tool the terminal
  offers, gated the same way: the decorator's `needsApproval` is the source
  of truth. When the model calls a gated tool — post to Slack, build a
  Google Doc, create a decision — the turn holds, a card appears in the
  thread with the call as the tool describes it (its own `formatApproval`,
  else the input's fields), and two buttons: Allow, Not now. The answer
  goes to `POST /chat/:id/approvals/:approvalId` `{ approved }`; the turn
  resumes with it — an approved call runs, a declined one is reported to
  the model as declined and recorded in the story as such. The card stays
  in the thread once answered, settled (allowed or declined), before the
  reply it preceded: the thread keeps `answered` with each call's position,
  so a reload shows the record too. A Slack message reads on the card as
  it will read in Slack (its marks rendered, `slackMarkdown.ts`); any other
  call renders as markdown; Raw shows the text as sent. The stream
  carries `approval-request` and `approval-answered`; a page that opens
  while a call is held finds it in `GET /chat/:id` as `pending` (with
  `busy`) and follows the turn by re-reading the thread until it settles.
  The day's list shows such a thread as `waiting` with "needs your go".
- **A tool at work, in its own words.** Every line a command prints in the
  terminal reaches the page while the tool runs: the session's tools get
  their own command service whose output is an `EventOutput`, and
  `toolOutputSink` in `createSession.ts` turns lines, stages, closing
  ticks, and command boundaries into `tool-started`, `tool-line`, and
  `tool-finished` events for the routes. The routes keep one `ToolRun` per
  call with the thread (`runs` on `GET /chat/:id`, like the cards) and
  stream the same three as frames. On the page the running tool's chip
  carries the time since it started and the last thing it said sits
  under it; a click opens everything it said. Once it ends the run folds
  to one line — a caret, the tool's name, and what it did in a small
  model's words: as a run ends with more than one line the sink asks
  `summarizeToolRun` (the fast role, twelve words at most) and the routes
  stream the answer as `tool-summary`, kept on the run as `summary`;
  until it lands, or when none comes, the run's last line stands in, and
  a page whose turn ended before the line reads the thread back for it. A
  click on the line unfolds the record of what the tool said. The day's
  list shows the running tool's latest line for a thread that is
  thinking. A tool that prints nothing keeps its chip from the model's
  own record of the call; the two never double up. That record — the
  session's `tool-call`, as the model's step ends — carries the call's
  input, and `callSubject` (`callSubject.ts`) turns it into one line on
  what the call was about: the field a tool acts on when it has one of
  the usual names (query, url, path, mission, message, text), else its
  first string; the first line only, spaces collapsed, cut to a chip's
  width; an address without its scheme. The routes stream it on the frame
  as `subject` and keep it on the run: a run that spoke for itself takes
  it once the record lands; a tool that ran without a word — a web search
  — gets a run for its record alone, so a reload keeps its chip; a call
  that asked first is recorded before it runs, and the run that follows
  takes that record over. The chip shows it after the name: `web search ·
  atlas roadmap reviews`. Two searches in one step are two chips.
- **The page waits through a restart.** A turn's stream carries a
  `heartbeat` frame every ten seconds when nothing else is said, so the
  page can tell a thinking model from a dead connection: silence past
  twenty-five seconds is a lost connection, however the socket looks (a
  reload in place leaves it open and mute). The page then waits for the
  service the way the terminal does — the ninety-second schedule of
  `fetchWithConnectRetry` — with "sky is restarting" where the reply
  would be, and takes the thread as the service holds it once it answers:
  a turn still running there is followed by the poller, one that finished
  is shown, and a thread that came back without the message, or not at
  all, lost its reply to the restart and says so under the message. A
  message the service never received (the send itself failed) waits the
  same way and goes out once the service answers. `turnStream.ts` holds
  the frame reader, the silence deadline, and the wait.
- **What a reply cost, in tokens.** The engine sums the SDK's usage over a
  turn's steps and approval rounds; the session puts it on the turn report
  and the turn's context-log entry (`usage`). The routes keep each reply's
  counts with the thread (`usage` on `GET /chat/:id`, by turn index) and
  send them on the `turn` frame with the profile that answered; the page
  shows one dim line under the reply — `312k in · 298k from cache · 4.1k
  out · Claude Opus 5` — and the terminal prints the same after each
  reply. Every model call also lands in the usage log, under the command
  making it; `sky ai:usage` rolls the day up
  ([2026-09-05](../../../_shared-ts/ai/docs/2026-09-05-usage-meter.md)).
- **Whether the thread is kept.** `Saves to today ▾` sits with the model and
  the budget, two stops: saves to today, or not saved. Set before the first
  message it is an incognito chat; it can change until the close. The
  setting rides the settings routes as `saves`; the end route follows it
  unless the caller says `save` outright. A thread that is not kept leaves
  no crash copy at rest — the routes remove the session's snapshot as each
  turn ends and the moment the setting turns off (`snapshotPath` on the
  host names it) — so it does not come back after a restart. Its end
  button reads Discard, the list marks it "not saved", and its end writes
  nothing: no transcript, no day entry, no memory or person facts
  ([2026-09-03](2026-09-03-a-chat-you-do-not-keep.md)).

The `timeline.ts` derivation: the seed entry counts what the baseline
gathered (the deduplicated universe, never the raw sweep sizes); a grown entry lists the documents its queries added (cut ones
included, marked) and the documents kept before that the budget cuts now;
a quiet turn carries the previous cuts forward, so a document cut two
turns ago is not pushed out again; a broken turn keeps its errors.

## The rules it lives by

- A change mid-turn is refused (409): the model is read when a turn
  starts, the budget when the context is rebuilt. The page keeps both
  controls out with the composer while a turn runs.
- The transcript records one model — the one answering when it is saved.
- A held call waits as long as it takes; there is no timeout. Closing the
  page does not answer it — the thread stays busy until someone does, or
  the service restarts.
- No standing grants on the web yet: every gated call asks. The terminal's
  per-file blessing ("don't ask again for this file") slots in through the
  same approval config when that lands.
- The wire never carries the whole universe twice: the stream carries
  counts, the context route carries the current records and the story's
  changes.
- The count shown anywhere is the latest assembly's. A pin, a drop, or a
  new budget reassembles between turns without a log entry, so the routes
  read the last rebuild report before the log.
- A closed turn still logs: zero kept under a zero budget is how the story
  tells "read nothing on purpose" from a recording gap. It is not the
  terminal's `/no-context`, which drops the universe but lets later
  questions query; Nothing queries nothing.
- Tool runs live with the thread, not the transcript: they are the
  page's record while the thread is held, as the cards are. The context
  log's tool records stay the saved trail.
- A run keeps its newest 400 lines; a mission narrates for an hour and
  the end of the story matters more than its middle.
- Not saved is about what stays behind, never about what the thread may
  read or do. The session writes its crash copy as every turn ends; the
  routes, not the session, decide it does not stay.

## Verified

- 2026-09-05 — the usage line: a scripted model that reports usage over two
  approval rounds sums into the turn's counts (engine test); the turn frame
  carries the counts and the profile, and the thread reads them back by turn
  index (route test).

- 2026-09-05 — the budget slider: on the real page, a slow click, a quick
  click, a drag and an arrow key each post their stop once, in order, and
  the strip follows; the Cerebras Qwen profile ends the slider at 50k with
  the stops past it grayed. Route tests: the window rides on the choice, a
  300k choice on the small-window model drops to 50k while 25k stays, the
  wide model takes 300k again, and a live thread switched to the
  small-window model has its budget lowered and its context reassembled
  within it. Shared helper tests: the stops, the nearest stop, the cap
  behind a window (131,072 → 79,257) and the fit.
- 2026-09-03 — not saved: a thread set not to save before its first message
  answers the setting, keeps no crash copy after its turn while a saving
  thread beside it does, is listed as not saved, and ends with nothing
  saved and the thread gone; a saving thread turned off loses its copy at
  once and, turned on again, writes one with its next turn; a setting that
  is neither true nor false is refused (route tests).

- 2026-09-03 — the fold: the scripted run's summary line follows finished
  on the stream and settles on the run (route test); the sink asks the
  summarizer once per ended run with its lines and how it ended, reports
  its line after the end, asks nothing for a one-line run, and reports
  nothing when the summarizer has nothing (sink test). Live on the page,
  notebook closed, a message that runs the day's items: the run folds
  the moment it ends with its last line as the label, the fast model's
  line replaces it a second later, a click unfolds the fifty-nine lines;
  on a turn whose one-word reply beat the line, the page's follow-up read
  picked it up.

- 2026-09-04 — the page waits: a held turn's stream carries heartbeat
  frames while it waits, all before the turn frame (route test); frames
  come off a stream whole however the bytes split, a stream that falls
  silent ends as a Silence, and the wait for the service runs its schedule
  through refusals and a 503 to the first answer, says gone on a 404, and
  gives up after the schedule (turnStream test). Live: a sixteen-second
  turn carried a heartbeat at ten seconds between its text frames; on the
  real page a not-kept turn was streaming when a server file was saved —
  the reply stopped, the line read "sky is restarting · 14s", the service
  answered without the thread, and the message read "turn failed — sky
  restarted while replying, and this chat isn't kept. Send it again to
  start over."

- 2026-09-03 — call subjects: the subject rule over a search, a fetch, a
  read, a mission behind its file id, unnamed fields, several lines, a
  long line, and calls with nothing to show (callSubject test). A
  scripted step whose search said nothing, whose mission narrated, and
  whose post asked first: the stream names each call's subject, the
  search stands as its own run, the mission's run takes its subject after
  it ended, and the post's record becomes its run — its started frame
  carrying the subject, the mission's not, now that frames serialize as
  they are emitted (route test). Live, a not-saved thread with the
  notebook closed that searched the web: the frame named the query, the
  run read back with it, and the page's chip read the tool's name and
  the query beside it.

- 2026-09-03 — tool lines: a scripted model whose call narrates two lines
  and holds; mid-run the thread carries the open run with both lines and
  the list shows the latest line; released, the stream carries started,
  two lines, finished in order before the reply, and the run settles with
  the reply (route test).

- 2026-09-02 — Reads nothing: a session started at zero gathers no
  baseline and reports itself closed; two closed turns call no producer
  and log as closed with nothing kept; a budget after them reassembles
  nothing yet and the next message gathers, running as the first
  gathering turn with the universe on its entry (session test). The route
  accepts zero and refuses a negative budget; a closed thread's stream
  carries `closed` on the start frame and no rebuild, its context route
  answers 404 with the closed note, and after a budget the story reads
  closed then seed (route test); the story kind itself (timeline test).

- 2026-09-01 — approval route tests: a scripted model asks to post to
  Slack; the thread holds the call with its card and shows `waiting`; a
  malformed answer and an unknown approval are refused; the go resumes the
  turn (request, answered, text, turn on the stream) and leaves nothing
  held; a decline finishes the turn and records the call as denied.

- 2026-09-01 — route tests: defaults before the first message, a choice
  kept for the thread and recorded in the turn log's budget, refusals
  (unknown model, zero or non-numeric budget, empty body), a smaller
  budget on a live thread cutting documents at once and every count
  agreeing; timeline tests over synthetic logs.
