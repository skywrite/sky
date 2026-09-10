---
created: 2026-09-01
updated: 2026-09-10
---

# Chat over HTTP — a thread, its tuning, and the story of its context

Design notes for `src/service/handler/chat/` and the page that drives it,
`theme/client/chat.tsx` with `controls.tsx` and `context.tsx`.

Reply timing starts at prompt acceptance, includes thread creation and the
first context load, and is saved on each turn through the
[shared timing system](../../../../_shared-ts/timing/docs/README.md).

The shared agreement summary, reviewer context, sources and user decisions follow the [legal review design](../../../../commands/all/legal/docs/README.md).

## What is built

### Files in the conversation

Drop files anywhere in a text conversation, choose them with the composer's
paperclip, or paste a file. Each appears as a removable clip before sending;
Send accepts a file with or without a typed question. Pending files stay in
the browser. Unsent text and attachments are saved by chat ID and restored
after refresh or navigation, including before the first message. Main chats
and reply threads own separate drafts. A rejected upload keeps the draft and its clips for correction.
There can be up to ten files totaling 20 MB in one message.

`theme/client/chatDraft.ts` owns this browser draft, separate from the server's
conversation history. Text and the current attachment revision are written
synchronously to local storage; IndexedDB retains the files' actual bytes and
MIME types. Attachment writes run in order, and restoration must match the
revision so an older list cannot bring back removed files. Acceptance clears
only the submitted text and files. The synchronous metadata also prevents
accepted attachments from reappearing if their background deletion is interrupted.
Storage failures remain visible with a retry action; Send waits for restoration
and cannot silently omit attachments that failed to load. These drafts belong
to this browser and origin; they are not notebook records or device sync.

Pending clips sit inside the rounded composer surface, above its message row.
The files, textarea, paperclip, Send, and voice control share the composer's
centered width; errors align with that same container. A count and total size
remain visible when the file grid is collapsed. Up to five files appear without
an inner scrollbar; larger collections scroll beneath the count. Images have
thumbnails and documents have format icons. Hovering a shortened filename
reveals its full name.
See [2026-09-07 — Clips belong to the composer](2026-09-07-clips-belong-to-the-composer.md).

The message route accepts multipart uploads with the same model, budget, and
filing settings as text messages. It reads through the console's `read_file`
implementation: PDFs and images become native model inputs, and supported
documents and spreadsheets become text under the same conversion and length
limits. These contents enter conversation history even with notebook reading
set to Nothing. Original bytes are copied to the thread's day attachments.

The accepted user message carries ordinary markdown attachment links, rendered
as clickable clips inside the same bubble as its text, with thumbnails for images. These survive reloads, recovery, filing,
and branching without a second browser-only attachment record. Recovery keeps
the native model content and attachment metadata; a saved chat or branch also
gives `read_file` the paths behind its earlier clips when it needs to reread.
Download links remain available after the thread closes. See
[2026-09-07 — Files clipped into chat](2026-09-07-files-clipped-into-chat.md).

Generated images use the same attachment store. The web host retains each
successful `ai:image` result before it reaches the model, adding browser URLs
and durable local paths for subsequent edits. Completed tool results display
immediately; the session also appends ordinary image Markdown to the assistant
reply so previews survive filing and branching without provider history.
This happens even if generation succeeds and the final model reply fails.
Only validated PNG, JPEG, and WebP bytes are served inline; the original
download URL remains an attachment. Server image commands do not open a
desktop viewer. The rendering lives in `theme/client/chatImages.tsx`.
Photo sizing, automatic edit masks and pixel preservation belong to the
[image command](../../../../commands/all/ai/image/docs/README.md).

### Voice in the conversation

The waveform immediately after Send starts voice inside the thread. The
connecting and live call show flowing cloud forms for Sky and Sonny on a voice stage, with mute,
microphone/speaker choices, research status, and End voice beneath them.
The text thread, live transcript, composer, context rail, and text controls
are hidden during the call. The composer remains mounted, preserving its
draft; ending voice or a connection failure returns to text. The brief
preflight read keeps the text surface visible with Send disabled until the
voice connection starts. Starting voice passes a bounded copy of the current
conversation to both speakers. Leaving the chat releases the microphone and
both audio connections. The former `/voice` page opens a new chat without
starting its microphone; voice auditions remain in Settings and at
`/voice/audition`. See [the voice-stage note](2026-09-07-voice-presence-in-chat.md).

Sky uses blue and periwinkle with white wisps; Sonny uses amber and coral with
cream wisps. Sky's silhouette is a circle and Sonny's is an upright triangle,
with drifting clouds inside both procedural volumes. Uniform speech pulses
preserve those silhouettes. Three.js uses
WebGPU when available and WebGL2 otherwise. Their separate audio streams drive
motion and light; transcript arrivals never animate them. Reduced motion freezes
idle movement and speech deformation while retaining a subtle light response.
Visual or analysis errors leave the call controls usable. The human models and
lip-analysis assets have been retired. See
[2026-09-08 — Cloud forms replace human avatars](2026-09-08-cloud-voice-presence.md).

Ending voice posts its transcript to `POST /chat/:id/voice` before continuing
with text or saving the thread. The route appends against the original message
count and accepts identical retries, refusing to replace newer conversation.
The transcript enters both model history and the normal recovery snapshot;
the chat's filing preference still decides what Save & close keeps.
Consecutive utterances from the same role share an exchange, with named Sky
and Sonny replies. An opening hello before the first user message is omitted
from the saved exchanges. Pending voice turns reappear in text if the
handoff fails, with a retry action outside the composer; uncompleted live
calls are held in the browser until they end. Text submission stays disabled
until the handoff succeeds. See [the integration note](2026-09-07-voice-inside-chat.md).

Saved voice replies omit "New chat from here…"; their retained speaker labels
also identify transcripts reopened from older calls. Completed text replies
continue to offer branching.

### Reply threads

**Reply in thread** on a completed text response opens a right-hand panel
with the original response, its replies, and a separate composer. The main
composer keeps its draft. Closing the panel leaves its agent running; the
source response shows the reply count and working or approval status.
Opening the same response again returns to the same thread. On a narrow
screen the panel fills the conversation area.

The person chooses this boundary. Messages sent in the main conversation
stay there. Tools and specialists run inside whichever conversation invoked
them; drafting and then creating a document can continue in one thread.
Reply threads cannot contain either reply threads or branches. Both routes
enforce this, beyond hiding their controls.

The thread inherits the conversation **through its source response**,
including native file inputs and tool results, then accumulates its own
history. Later parent messages do not enter that snapshot. This supports
reviewing related documents together in the main conversation and opening
a thread afterward to draft a response using the combined review.
Automatic notebook retrieval excludes a conversation's own transcript and
reply directory, plus those of its ancestors, so it cannot silently bring
refinement chatter back into its parent or a new fork.

Each chat file owns its companion directory:

```text
Review.md
Review/
  _threads/
    Response.md
  Alternative.md
  Alternative/
    _threads/
      Response.md
```

The child records `parent: { chat, turn, kind: thread, key }` in YAML.
`chat` is notebook-relative; `key` identifies the selected response and its
preceding conversation. The parent discovers its children from this backlink
and does not keep a second authoritative list. Ordinary branches keep their
existing parent format. Branches own their threads; a fork inherits no
reply-thread histories. GraphQL exposes `branches` and `replyThreads`
separately, and the day and sidebar lists show the parent conversations.

Recovery snapshots keep active threads under either filing preference.
Saving a parent files its replies too, after reserving all participants and
filing any unfiled ancestors first. Saving waits for running replies; closing
the panel does not. The parent title is pinned before the first child is
created and survives recovery, preserving the folder's identity.

The existing v2 `CONTEXT-LOG` JSON block has two optional additions:
`statistics` aggregates this file's messages, replies, token usage, elapsed
time, model calls, and tool calls; `session` retains provider history and
host state for continuation. Statistics exclude inherited turns and child
threads. Recorded model timings include nested agents, so the turn's main
usage is not added a second time. Saved Markdown still holds only each
file's own dialogue. A conversation digest guards restoring provider history
after a transcript is edited; older files continue from their readable text.

### Text chat and thread controls

A thread is a ChatSession backed by a temporary recovery snapshot throughout
its active life, including when it will not be filed. A message is a POST whose response is the turn's event stream; the page
renders the same events the terminal renders. Around that, three things
a person can see and touch:

- **Drafts can be edited in chat.** The shared writer's drafts have a frame
  with Edit, Copy, Undo, previous versions, and Ask Sky to revise. The latter
  opens the response's existing reply thread, focused on the same draft ID.
  The current draft updates in place; the transcript keeps its original text.
  Storage, learning, and conflict behavior belong to
  [writing voice](../../../../lib/writingVoice/docs/README.md#editable-drafts-in-chat).
  The shared chat prompt puts each
  message draft in one Markdown blockquote during review and revision,
  including drafts destined for Slack. Introductions and editing notes stay
  outside the quote; the enclosing review quote is removed for delivery.
  Slack syntax and its decorative subject underline apply when
  preparing the delivery payload. `theme/client/chatMarkdown.ts` also renders
  older fenced Slack drafts as quoted prose when a reply finishes or is read
  back: paragraphs, emphasis, lists, and links, with the underline removed.
  Drafts already inside a quote keep that single review container. It
  recognizes Slack-labelled fences and the former subject/underline pattern
  in plain-text fences; other code stays code. Long literal lines wrap within
  the reply. Conversation text and approval payloads retain their source.
  See [2026-09-08 — Drafts are read here](2026-09-08-drafts-are-read-here.md).
- **Text stays selected through background refreshes.** Completed replies
  and rich approval previews use the
  [shared HTML renderer](../../theme/docs/README.md#text-selection-and-rendered-html).
- **Progress and the queries behind a reply.** A compact activity row sits
  below the message while context is gathered and the reply is prepared.
  Its wording follows the stage; quiet reading and thinking waits vary
  their wording every eight seconds, with elapsed time across the turn.
  Tool output and approval cards speak for their own waits. **GraphQL
  queries** opens the full context query set, with selectable code and a
  Copy query action. The disclosure stays open through streaming and turn
  completion, and is also available in the Context timeline. The session's
  `context-queries` event carries the set as soon as it is known; the thread
  read-back merges that live set with saved context-log entries. Reused
  queries are labeled as context carried forward, not new executions.
  Queries returning no files remain recorded. See
  [2026-09-06](2026-09-06-queries-beside-the-wait.md).
- **The model a thread thinks with and how much it reads.** Both sit under
  the composer, beside the files-in-context count: `Opus 5 ▾` opens the
  configurations from Settings › AI grouped by provider, with the role
  each one holds; `Reads up to 300k ▾` sets the reading budget on a
  slider — Nothing, 25k, 50k, 100k, 300k, 500k, 750k. A model whose host
  serves less than the stops ask (Cerebras serves Qwen at 131,072 tokens a
  request) ends the slider at the last stop that fits, 50k there; the
  stops past it stay drawn, grayed, and a budget above them drops to that
  stop — on the page, in the routes, and behind `sky ai:chat
  --max-context`, which says so ([2026-09-05](2026-09-05-the-budget-is-a-slider.md)).
  Every message POST carries `{ message, profile, contextTokens, saves }`
  captured from the composer, including connection retries. These choices
  are required: an older client that omits them must reload, and an unknown
  profile or incompatible budget is refused before context or model work.
  The routes reserve the turn before restoration or construction, build a
  new thread with its request's choices, and apply them to an existing or
  restored thread before it starts. Server defaults cannot override the
  message. Send waits while the composer loads or applies settings.
  `GET /chat/:id/settings` answers the
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
- **A thread outlives a restart.** Every completed turn snapshots the thread
  to the state directory, as the terminal does. When the service starts it
  reads its own snapshots back — a thread id in the name, never a
  terminal's pid — and every one becomes a thread again: in the day's list
  and the rail with its turns on the page at once, its context restored at
  its next message, and the same model, reading budget, and filing preference.
  Recovery includes the full model history with tool calls and results; a
  continued saved chat keeps its file identity. Only ending a thread removes
  its snapshot. A stop mid-turn preserves the unanswered message and all
  completed turns. A browser continuation whose thread cannot be restored
  is refused before a new session can silently replace it. See
  [2026-09-07](2026-09-07-recovery-is-independent-of-filing.md).
- **A new chat from here.** Every completed text reply offers it. The branch is a thread
  that keeps the turns through that reply and goes its own way after them;
  on its page the inherited turns read dimmed, then a line says where it
  came from and from which turn, and the thread it left carries a line
  where the branch left. Branching writes nothing: the branch is a thread
  like any other until it is ended. What it does pin is the family's name
  on the thread it left — the titler over the shared turns, or the name
  the thread already had — so the folder the branch will file into is
  known; the parent keeps that name when it saves. `POST /chat/:id/branch`
  `{ turn, key? }` answers the new thread's id and the parent key it carries.
  The service supplies that reference on completed turn frames and thread
  read-back; the page never counts interrupted replies as branch points.
  The key identifies the conversation through the selected reply, surviving
  snapshot formatting while rejecting missing or changed history with a
  recovery message. A refused branch keeps the page's messages intact.
  Existing tabs can still use the original `{ turn }` request when that turn
  exists. The optional key strengthens validation for updated pages without
  forcing older pages to reload. See the
  [compatibility correction](2026-09-07-existing-tabs-can-branch.md).
  See [2026-09-07](2026-09-07-branching-after-an-interrupted-reply.md).
  When a branch is ended and saved, a parent that has no file yet is filed
  first, lightly (its pinned title, no tag, rel or memory work), and goes
  on talking into that file; the branch then files beside it, in the
  folder carrying the parent's name, holding only its own turns and its
  parent key. The rail lists a day's branches under the chat each left.
- **A saved chat opens to continue.** Continue chat in either day list opens a thread
  whose session writes back to its file — `POST /chat/open` `{ chat }`
  with the path relative to the notebook root; opening the same file again
  finds the same thread. Its turns are on the page at once, its title is
  the saved one, the composer reads "Continue this chat…", and a branch
  from one of its replies is the retroactive case: a new chat from a
  morning's conversation, this afternoon. The saved title itself opens the
  notebook document, and the conversation header offers **Open document**.
  See the [day's document navigation](../../day/docs/2026-09-08-saved-chat-document-links.md).
- **A name for the thread.** The fast model names the opening question
  alongside the reply; a branch uses its first own question. The header,
  day lists, and browser tab (`sky:chat - <subject>`) follow that subject,
  with the full first message as the fallback. Existing saved titles stay
  fixed; a new file's `summary:` is chosen independently at save.
- **A tool call that needs a go.** The page offers every tool the terminal
  offers, gated the same way: the decorator's `needsApproval` is the source
  of truth. When the model calls a gated tool — post to Slack, build a
  Google Doc, create a decision — the turn holds, a card appears in the
  thread with the call as the tool describes it (its own `formatApproval`,
  else the input's fields), and two buttons: Allow, Not now. The answer
  goes to `POST /chat/:id/approvals/:approvalId` `{ approved, always? }`; the turn
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
- **Calendar invitations and updates.** The calendar tools prepare and read
  receipts without asking; sending or saving uses an asynchronous formatter to
  show the stored event details before approval. See the
  [calendar workflow](../../../../lib/calendarScheduler/docs/README.md#chat-and-voice).
- **Tool progress and inspection.** The engine emits `tool-execution-start`
  as streamed arguments begin (`preparing`) and immediately before execution
  (`running`), then `tool-execution-end` with the result or error. The routes
  correlate these by provider call ID, keep `ToolRun` records on the thread,
  and stream `tool-updated` frames. This makes silent tools visible before
  they finish and keeps repeated calls of the same tool separate. The chip
  shows phase, completion status, and elapsed time; every chip expands to
  parameters, result, error, and any command activity. An expanded inspector
  stays open through completion and preserves text selection during polling.
  `callSubject` provides a short input summary beside the tool name.

  Progress is a shared engine contract: new tools require no individual UI
  wiring. `ToolProgress` merges local execution and provider stream events,
  including provider-run tools, approval waits, and failures before execution.
  Late stream callbacks cannot restart a completed call. When a turn exits,
  any call still open ends with an incomplete-result error instead of leaving
  a running indicator behind. Timers keep displaying seconds past one minute.

  Command output still arrives through `toolOutputSink` as `tool-started`,
  `tool-line`, and `tool-finished`; it enriches the matching run with activity.
  A command boundary cannot finish an engine-tracked tool before it returns.
  `summarizeToolRun` uses the fast role for a short completion summary when
  there are multiple lines. The later step-end `tool-call` record merges into
  the existing call instead of creating another chip.

  Inputs, outputs, errors, and timings are persisted in recovery host state
  and returned by `GET /chat/:id`. Dedicated credential fields are redacted
  from the inspection record without changing the arguments sent to tools.
  Older snapshots recover arguments and results from provider message history
  when available, without inventing timings. Unfinished recovered calls are
  marked interrupted. Filed context logs remain concise digests; the recovery
  snapshot holds the detailed record. Parameters show what the caller passed,
  not additional context a tool loads internally.

  What a tool said is read, not echoed (`toolLines.ts`, `toolLinesView.tsx`,
  `toolLines.css`). A line that begins with `→` is a call the tool made of
  its own — the name, and what it asked on the line or dedented from beneath
  it; the older JSON form is read too, a record cut mid-way as far as it
  goes. Every entry is a card: a call carries its name and what it asked, a
  query as a block colored by token, a notebook file as a link to its page;
  any other line is the tool's words, several paragraphs as markdown. The
  cards flow with the page and the fold above closes them. Parameters and
  result go through `FieldsView` — field by field, a string as its text, a
  `graphql` string as the colored block, a list one item per line, anything
  nested as JSON — so no escaped query reaches the page. `ai:research`
  narrates its calls this way (`describeCall` in `research/lib/narrate.ts`,
  the query as graphql-js prints it); a tool that narrates its own calls
  prints the arrow, the name, and the input whole. See
  [2026-09-03-tool-lines-on-the-page.md](2026-09-03-tool-lines-on-the-page.md).
- **The message a restart took.** Every active thread's snapshot is written
  as each turn begins as well as when it ends (the session's
  `snapshotOnSend`, always enabled by the web host), so a service that
  dies answering comes back knowing what it was asked. On restore a
  snapshot ending on the person's message has that message set apart
  (`interrupted.ts`): the thread lists as failed with "sky restarted while
  replying — send it again", `GET /chat/:id` carries it as `interrupted`,
  the page shows it where the exchange would be with a Send again, and the
  next message on the thread clears it. The model never sees the
  unanswered turn; a resend is a fresh turn.
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
  send them on the `turn` frame with the profile that answered. The page
  keeps the model, token usage, and timing under **Reply details**, closed
  by default beneath each completed reply. Opening it shows labeled
  values grouped into Tokens and Time; cached input is identified as part
  of total input. Errors remain visible beside the reply. The terminal
  prints its usage line after each reply. Every model call also lands in
  the usage log, under the command making it; `sky ai:usage` rolls the day up
  ([2026-09-05](../../../_shared-ts/ai/docs/2026-09-05-usage-meter.md)).
- **Whether the thread is filed.** `Saves to today ▾` sits with the model and
  the budget, with two stops: saves to today, or not saved. The preference
  controls the final archive and save-time learning, and can change until
  close. Saving a new chat also logs its transcript link in the starting
  day's Complete list, under the configured default category. The page
  confirms logging or reports a day-file failure alongside the saved
  transcript. Resumed chats retain the store's existing rule of skipping
  another day entry. See [2026-09-07](2026-09-07-saving-includes-day-logging.md).
  Both choices keep temporary recovery snapshots during the active
  conversation. The settings routes carry `saves`; changing it updates the
  snapshot immediately, and restoration keeps that choice. For Not saved,
  the end button reads Discard, the list marks it "not saved", and ending
  removes recovery without a transcript, day entry, memory, or person facts.
  Discard is the explicit end of an active conversation; a server restart
  is not. See [2026-09-07](2026-09-07-recovery-is-independent-of-filing.md).


The `timeline.ts` derivation: the seed entry counts what the baseline
gathered (the deduplicated universe, never the raw sweep sizes); a grown entry lists the documents its queries added (cut ones
included, marked) and the documents kept before that the budget cuts now;
a quiet turn carries the previous cuts forward, so a document cut two
turns ago is not pushed out again; a broken turn keeps its errors.

- **A go you already gave is not asked for again.** The web host keeps the
  terminal's ledger per thread (`SessionBlessings`): a Google file reference
  pasted into a message blesses that file for the process; a file a tool
  reports as created is blessed for good; "Allow for this file" on a card
  is a durable go. The tool approval config consults it, so a blessed call
  runs inline with no card. Durable keys ride the thread's snapshot and
  come back with a restored thread. A tool may also exempt calls outright
  (`needsApprovalFor`) — `google_agent` runs create-only missions without
  asking on every surface ([2026-09-03](2026-09-03-the-go-you-already-gave.md)).

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
- Not saved is about what stays behind after Discard, never about what
  the thread may read or do, or whether an active conversation survives
  a restart. Snapshot writes are serialized; close waits for them before
  removing the copy.

## Verified

- 2026-09-08 — a tool's lines read as cards: parse, compact, dedent, and
  token tests on the page's reader; `describeCall` tests on the research
  narration; headless captures over synthetic threads (the older cut record,
  the new narration, a running chip) in light and dark.

- 2026-09-08 — draft rendering tests cover legacy and labelled Slack fences,
  quoted drafts with commentary outside, preserved code, and inert HTML.
  An isolated browser regression checks
  desktop and mobile wrapping, selections across paragraphs and polling,
  mouse dragging through a refresh, changed replies, completed turns, and
  reloads.

- 2026-09-07 — an isolated Chromium check using the real client and mocked
  responses preserves selections through repeated sidebar refreshes,
  including a mouse drag across a refresh, a range spanning paragraphs,
  and a rich approval preview. Active thread polling preserves selections
  when it returns unchanged HTML; changed reply HTML still updates.

- 2026-09-07 — a restored chat accepts the original turn-only request from
  an existing tab and creates a branch with the exact inherited conversation;
  a turn beyond the recovered history remains refused.

- 2026-09-07 — branching survives a disk restore and resend after an
  interrupted exchange. HTTP checks reject missing or changed branch
  references, including an in-range turn with the same reply text under a
  different question. A browser test closes the reply stream mid-answer,
  recovers a shorter server history, sends again, and branches at server
  turn 2 while three replies remain displayed; a refused branch preserves
  the page and its partial text.

- 2026-09-07 — web save defaults exercised through HTTP against a temporary
  notebook: save writes the transcript and a resolving day-file link in the
  default category, discard leaves the day untouched, and a missing day file
  returns a logging failure while preserving the transcript.

- 2026-09-07 — fresh route instances restore from real disk snapshots under
  both filing settings, including exact model history with tool results and
  provider metadata, conversation, notebook universe, model, and budget.
  Changing settings on a restored thread before its first message preserves
  its history through another restart. Discard removes the snapshot and
  leaves no filed transcript. Missing browser continuations are refused;
  interrupted snapshots remove only the pending message from model history.

- 2026-09-06 — saved branches on the parent: after a branch files itself
  beside its parent, the parent thread's body lists it with the turn it
  left after, and the page marks it under that reply — a mark that opens
  the saved chat as a thread (`chatRoute_test.ts`, the branch test).
- 2026-09-06 — one Sources list: a saved chat whose reply named its own
  sources and had the searched pages appended shows the body without either
  list and one "Sources · 20" fold, on reload and as the reply finishes
  ([the note](../../../../_shared-ts/models/Chat/docs/2026-09-06-one-sources-list.md)).
- 2026-09-05 — each message carries its model, reading budget, and save
  preference: new and existing threads use them before the model runs;
  restored threads keep the conversation and honor the next request's
  choices. Missing, malformed, unknown, and incompatible settings fail
  before construction. Competing messages and settings changes cannot
  replace the choices of a turn being constructed (route tests). An
  isolated browser check confirms that Send waits for initial settings
  and an in-flight selection, preserves unsent text while waiting, and
  retries a failed connection with an identical message and settings.

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
- 2026-09-03 — historical Not saved behavior, superseded by the
  2026-09-07 recovery rule: a thread set not to save before its first message
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
