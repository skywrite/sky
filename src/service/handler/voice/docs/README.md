---
created: 2026-08-30
updated: 2026-11-26
---

# Voice over the web — service side

The browser sends its SDP offer to `POST /voice/:id/session`. This handler
creates one GPT-Live WebRTC session with the trusted configuration and returns
its SDP answer. The project key stays on the server; audio travels directly
between the browser and OpenAI. Sol selects tools through managed Responses
delegation, and the browser relays completed function calls to `/tools`.

The chat route supplies the owning session's tool runtime, approval policy,
file grants, and artifact hooks. Voice has no separate command allowlist; it
adds `search_notebook` and the spoken approval tools, and pages `read_file`
([browser voice](../../../../commands/lib/voice/docs/README.md#conversation-and-processing)).
Spoken approvals use the same prepared summaries as chat cards. Large and
multimodal outputs go directly to Live over the trusted server sideband;
backend continuation follows all tool outputs on that same connection.
Ending a call through `/end` aborts running tools and rejects late requests;
a running tool holds service reloads until it settles and the chat lease then
releases. New calls use new IDs. Heartbeats clean up abandoned leases.
The `/_api/audition` routes create previews with generated silent input,
no microphone access, and no notebook context or task backend.

The sideband attaches when the session is created and also carries the
service's own notes: page updates after tools and heartbeats, and the results
of research that ran in the background. Each note has an event ID starting
`sky-note-`; Live answers a rejected one with an `error` naming that ID, which
the sideband logs and skips and the browser skips. Every other error still ends
the call. Background research runs under the call's lifetime but outside the
tools that ending a call waits for: `/end` aborts it and returns at once.
`/continue` logs a failed continuation and answers it with a JSON message.

The owning design and Live protocol invariants are in
[browser voice](../../../../commands/lib/voice/docs/README.md).
Calendar preparation, receipts, and confirmation follow the
[calendar workflow](../../../../lib/calendarScheduler/docs/README.md#chat-and-voice).

- Tool curation and the spoken-confirm gate:
  [2026-08-30 — tools and the spoken confirm](2026-08-30-tools-and-spoken-confirm.md)
