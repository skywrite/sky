---
created: 2026-09-01
updated: 2026-10-08
---

# Chat model — the pieces under every chat host

- **ChatEngine** — one model turn: streaming, tool exchanges, the approval
  protocol. Host-blind; scripted invokers replace the model in tests.
- **ChatSession** — a whole conversation: context pipeline, turns, crash
  snapshots, save. Hosts (the ai:chat CLI, the web service) supply prompts,
  tools, and approval UI through its options.
- **ChatStore** — transcripts on disk: save, autosave (crash insurance),
  resume. `document/` is the ChatDocument markdown format itself.
- **ChatContext** — what a turn gets to see; has its own docs
  ([ChatContext/docs](../ChatContext/docs/README.md)).

Save-time person curation uses full dated turns; its evidence and write rules
live in [Person profiles](../../Person/docs/README.md).

Reply-thread ownership, inherited tool history, filing, and per-file statistics
are defined in the [chat host's design](../../../../service/handler/chat/docs/README.md#reply-threads).

Agreement-review context and continuation links follow the [legal review design](../../../../commands/all/legal/docs/README.md).

Draft continuation links and version ownership follow the [writing voice design](../../../../lib/writingVoice/docs/README.md#editable-drafts-in-chat).

## Relationships to records discussed in the chat

Saving with auto-rel enabled also resolves conversational references to dated
notebook records. "My meeting with Jane on Friday" is enough when the record
can be identified; an exact date, time, filename, or link is unnecessary.
The resolver (`lib/notebook/enrich/documentRel.ts`) grounds quoted references
from the conversation against existing files and writes canonical
`YYYY-MM-DD/subpath` time refs, without the `.md` extension. Loaded context
paths are lookup hints, never evidence that a document was discussed.

These refs append on every save, including resumes with an existing `rel`.
Existing spellings survive, equivalent refs deduplicate, and ambiguous or
incomplete searches add nothing. `--no-auto-rel` skips this lookup along with
entity suggestions. External artifact relationships retain their own path.

Three sources feed rel besides the matcher's judgment, each added on
2026-10-07 after a saved chat missed the organization, the video and the note
it was about ([narrative](2026-10-07-rel-missed-what-the-clipped-transcript-hid.md)):

- **Entity suggestions read the whole conversation.** The rel chooser gets the
  full transcript with timestamps, not the classifier's 8k packing with its
  1,200-character clip per reply, and extraction runs over overlapping windows
  whose subjects are unioned. The selector reads the passages naming each
  subject rather than whichever characters came first.
- **Explicit phrases are read without a model.** "today's memo", "this
  evening's Loom", "Jane's deck from yesterday" become dated mentions by rule;
  the matcher still decides what they refer to, and a dated mention also
  offers the context documents from that day as candidates. The model's own
  extraction runs on the balanced role.
- **The chat's own products are facts.** Notebook documents a writing tool
  created during the session arrive through the session's created-documents
  hook and join rel directly, without a chooser, even with auto-rel off.

Place subjects and country creation follow the shared
[place relationship rules](../../../../lib/places/docs/README.md#automatic-relationships-and-country-selection).
New turns in a resumed chat can append place links even when other entity
relationships are already present.

## Fitting a conversation to its model

The notebook slider is an estimated retrieval allowance, not the size of the
whole request. `ChatEngine/requestBudget.ts` checks each SDK model call,
including tool steps and approval continuations. Instructions, the conversation,
tool definitions and results must fit together with room for output. Declared
profile windows travel with the resolved model; an undeclared window can also
be learned from a provider's context-length rejection.

Claude requests are [counted](https://platform.claude.com/docs/en/build-with-claude/token-counting)
after the SDK has serialized their actual payload,
through `ai/inputTokenLimit.ts` and the provider's fetch adapter. This avoids
maintaining a second serializer for tools, thinking and native attachments.
The same boundary checks the complete UTF-8 body against Anthropic's separate
[32 MB request limit](https://platform.claude.com/docs/en/api/errors), before
either counting or generation. A token allowance cannot bound base64 bytes.
The guard is scoped to one provider call so it cannot affect other chats or
tools' nested agents. The actual output allowance and a small margin are
reserved. The working target is 85% of the model window, leaving room for
further tool steps. Irreducible input that fits the hard limit can still run.
OpenAI Responses uses its
[input token counting endpoint](https://developers.openai.com/api/docs/guides/token-counting)
at the same SDK serialization boundary. Native image and PDF encodings are
transport bytes, not prose tokens: estimating the base64 string can reject
a small image edit as a million-token conversation. The count receives the
original native inputs and tool schemas with the model's options; generation
keeps the original payload. Compatible local providers retain a separate
identity and use a conservative estimate. If either counting endpoint is
unavailable or cannot count a supported generation input, a context-length
rejection still triggers the same bounded retry.

Capacity reductions reassemble notebook retrieval by relevance first, keeping
the person's allowance and document pins. Next, identified retrieval prefixes
in earlier user messages become source references; older textual tool results
then become explicitly labelled excerpts. User prose, instructions, native
attachment originals, and tool call/result pairs are preserved. `workingContext.ts`
records source boundaries by user turn, length, and hash, alongside their paths.
Legacy snapshots require both the exact original user suffix and the retrieval
log before adopting a source boundary. A quoted marker alone is never enough.

`attachmentContext.ts` replaces earlier binary input parts with reopenable file
references after a later assistant step exists; the source headers, recorded
findings, tool receipts and original history remain. A reference never asserts
inspection. New reads carry the archived copy's path so a subsequent file move
does not break rereading. Legacy source headers are supported; bytes without a
reopenable source are retained. A fresh batch that exceeds the body limit defers
older members explicitly and keeps the newest file for inspection. Deferred
members remain pending through recovery and branches until an individual read
of the same source and contents has a subsequent model step. Prompts require
recording relevant findings and inspecting deferred files separately. Both
local byte-limit errors and provider 413s retry only the rejected model request;
irreducible input reports the file/request limit rather than suggesting a larger
token window. No attachment is uploaded to separate provider file storage.

The SDK's and engine's original history is never shortened: reductions exist
only in the outgoing request. Their checkpoint survives recovery and filing;
branches inherit only the state relevant to their history. Omitted text must
be reread before relying on its details. A retry repeats only a rejected model
request, never a tool that already executed. Irreducible oversize input receives
a useful capacity error rather than silent message deletion.

The final kept set replaces the current turn's context statistics and cut
records. `stats.requestBudget` distinguishes the effective retrieval cap from
the selected `budget`; `adjustment` records the reduction for the reply and
Context timeline, including after recovery. This is distinct from `usage`,
which sums billed tokens over every model step and is not a window measurement.

A failed turn is also durable. `ChatSession` records an assistant entry with
its partial text and error, including when no text was produced. Recovery
metadata restores the error on that entry. The engine waits for running tools
to settle and retains completed call/result pairs before dropping unfinished
calls. Retrying can therefore inspect completed effects. Host polling and
reloads read the same failure as the live stream; a failed reply is not a
successful branch point.

## When the engine ends a turn

A tool loop ends in one of two hands. The model's: it writes, and the
turn is done. The engine's: the step cap (`maxSteps`, forty by default —
a backstop, not a budget; it was five) or the repetition guard says stop. An engine-ended turn used to end on the
last tool result and read as a finished reply — the opening sentence, the
sources, nothing about the work left undone. Now it gets a **closing
step**: one more model step whose last message is a notice — the reason,
and the ask to write, not call. The notice is prompt only, never history.
Its text is the reply's last paragraph. If the model
calls tools anyway, the engine writes a fixed closing line itself. The
result carries `cutShort` (`steps` or `repetition`); the CLI prints a dim
line from it, the page shows the closing text.

The **repetition guard** (`ChatEngine/repetitionGuard.ts`) wraps every
tool for the turn. The same tool, the same input, the same result is a
call that taught the model nothing: the second identical result carries a
note, the third identical call is refused unrun with the reason in the
model's terms, and three refusals end the loop through the closing step.
Inputs alone never count — a re-read after a write is normal — and a
result that carries a clock never looks identical, so the guard fails
quiet. The Google agent's mission tools sit behind the same guard
(`google/agent/lib/tools.ts`), notes and refusals only; its own step cap
ends a mission. Read the [2026-09-06 note](2026-09-06-a-turn-that-stops-says-so.md).

A **Stop** from the host is the turn's abort signal. The SDK hands it to
every tool call, and the chat wrapper (`commands/lib/chat/notebookTools.ts`)
runs the command on a scope forked with it, so the command sees the Stop as
`context.signal` — and so does every command that one composes. The engine
still waits for a running tool to settle before the turn ends, because a
tool that writes may be mid-write. So a command that never reads its signal
holds the Stop until it finishes on its own. That is the command's defect,
not the engine's: a loop that makes one call per item checks the signal per
item, as `slack:unread` does per conversation. Read the
[2026-09-23 note](2026-09-23-stop-reaches-the-command.md).

## Notes

- [2026-10-08 — one go stands for every chat](../../../../service/handler/chat/docs/2026-10-08-one-go-stands-for-every-chat.md): file grants left the chat file's `approvals:` key for a notebook-wide ledger; a chat file no longer carries grants, and nothing reads the key old files still have.

- [2026-10-05 — working context and durable failures](2026-10-05-working-context-and-durable-failures.md): retrieved source prefixes must be compactable independently of user prose, and failures must survive the same recovery path as replies.

- [2026-10-04 — admission by evidence, and context that only grows](../ChatContext/docs/2026-10-04-admission-by-evidence-and-append-only-delivery.md): a document ships on evidence, not budget room; the first assembly is a byte-stable segment and later documents arrive as additions with the person's message; a shipped document is held for the session; OpenAI reads the prefix back only with the conversation's prompt cache key.

- [2026-09-23 — Stop reaches the command](2026-09-23-stop-reaches-the-command.md): the turn's abort signal rides into the command's context; a long loop checks it per item; the page names the tool a Stop waits on.

- [2026-09-07 — files clipped into web chat](../../../../service/handler/chat/docs/2026-09-07-files-clipped-into-chat.md): a session can accept native document parts with a user message and retain their attachment metadata through recovery.

- [2026-09-07 — voice inside Chat](../../../../service/handler/chat/docs/2026-09-07-voice-inside-chat.md): externally delivered speech appends to model history and recovery without rerunning the text model; later context turn numbers include those exchanges.

- [2026-09-07 — recovery is independent of filing](../../../../service/handler/chat/docs/2026-09-07-recovery-is-independent-of-filing.md): active web chats keep snapshots under either filing preference; recovery includes full model history and host settings.

- [2026-09-07 — A blank is no value](2026-09-07-a-blank-is-no-value.md): a model's empty optional field is dropped before the approval policy and the command see it.
- [2026-09-06 — A turn that stops says so](2026-09-06-a-turn-that-stops-says-so.md): the closing step and the repetition guard.
- [2026-09-06 — nested chat files and the day's shared branch hierarchy](../../../../service/handler/day/docs/2026-09-06-videos-and-chat-branches.md)
- [2026-09-06 — conversational references become document relationships](2026-09-06-conversational-document-rel.md)
- [2026-09-06 — one Sources list under a reply, its own and the searched pages merged](2026-09-06-one-sources-list.md)
- [2026-09-05 — the chats folder is named once, in nbfs](../../../nbfs/docs/2026-09-05-the-chats-folder-is-named-once.md)
- [2026-09-05 — per-turn timing is saved before autosave, with millisecond timestamps](../../../timing/docs/README.md)

- [2026-09-05 — shared timings cover complete replies and nested research](../../../timing/docs/README.md)

- [2026-09-05 — a reason the SDK did not read is quoted, not dropped](2026-09-05-a-reason-the-sdk-did-not-read.md)
- [2026-09-04 — an answer with no body is named, not echoed](2026-09-04-an-answer-with-no-body.md)
- 2026-09-06 — `ChatSession.snapshotOnSend`: a host can have the crash snapshot written as each turn begins too, so a restart mid-turn leaves a thread that knows what it was asked ([the message a restart took](../../../../service/handler/chat/docs/2026-09-06-the-message-a-restart-took.md))
- [2026-09-03 — the cache tail moves on every tool step](../../../ai/docs/2026-09-03-cache-tail-every-step.md)
- [2026-09-01 — blessed files skip the approval round](2026-09-01-dynamic-tool-approval.md)
