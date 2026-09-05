---
created: 2026-09-01
updated: 2026-09-05
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

## Notes

- [2026-09-05 — a reason the SDK did not read is quoted, not dropped](2026-09-05-a-reason-the-sdk-did-not-read.md)
- [2026-09-04 — an answer with no body is named, not echoed](2026-09-04-an-answer-with-no-body.md)
- [2026-09-03 — the cache tail moves on every tool step](../../../ai/docs/2026-09-03-cache-tail-every-step.md)
- [2026-09-01 — blessed files skip the approval round](2026-09-01-dynamic-tool-approval.md)
