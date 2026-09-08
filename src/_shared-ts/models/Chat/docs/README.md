---
created: 2026-09-01
updated: 2026-09-07
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

## Notes

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
