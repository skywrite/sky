---
created: 2026-09-01
updated: 2026-09-06
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

## Notes

- [2026-09-06 — conversational references become document relationships](2026-09-06-conversational-document-rel.md)
- [2026-09-06 — one Sources list under a reply, its own and the searched pages merged](2026-09-06-one-sources-list.md)
- [2026-09-05 — the chats folder is named once, in nbfs](../../../nbfs/docs/2026-09-05-the-chats-folder-is-named-once.md)
- [2026-09-05 — per-turn timing is saved before autosave, with millisecond timestamps](../../../timing/docs/README.md)

- [2026-09-05 — shared timings cover complete replies and nested research](../../../timing/docs/README.md)

- [2026-09-05 — a reason the SDK did not read is quoted, not dropped](2026-09-05-a-reason-the-sdk-did-not-read.md)
- [2026-09-04 — an answer with no body is named, not echoed](2026-09-04-an-answer-with-no-body.md)
- 2026-09-06 — `ChatSession.snapshotOnSend`: a host that keeps the thread has the crash snapshot written as each turn begins too, so a restart mid-turn leaves a thread that knows what it was asked ([the message a restart took](../../../../service/handler/chat/docs/2026-09-06-the-message-a-restart-took.md))
- [2026-09-03 — the cache tail moves on every tool step](../../../ai/docs/2026-09-03-cache-tail-every-step.md)
- [2026-09-01 — blessed files skip the approval round](2026-09-01-dynamic-tool-approval.md)
