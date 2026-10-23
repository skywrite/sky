---
created: 2026-09-06
updated: 2026-10-16
---

# Browser voice

Sky is the single speaking participant. `gpt-live-1` listens and speaks over
one browser WebRTC connection. Its managed Responses backend is
`gpt-6.1-sol`, with `service_tier: ultrafast` and `reasoning.effort: high`.
The retired second voice and Qwen/Astra research loops are no longer part of
browser calls. Existing saved two-speaker transcripts remain readable.

## Conversation and processing

`voice.prompt.md` supplies a short conversation, interruption, and delegation
policy. `ask-notebook.prompt.md` belongs to Sol: it adds the notebook snapshot,
clocks, calendar, and spoken confirmation policy to the same standing instructions
and tool procedures used by Chat. Initial context is bounded and source-labelled; missing records and
collection failures are evidence limits. Notebook prompt overrides still take
precedence and apply to newly started calls.

Voice opens a lease on its owning chat. `ChatSession.conversationTools` supplies
the same command registry, local files, writing drafts, research, plans, and
browser tasks as text. There is no voice allowlist or second tool factory.
The adapter converts schemas and native model outputs; tool execution still
uses Chat's context hooks, calendar safeguards, approval policy, and persistent
file grants. Each delegation builds against the latest spoken user request and
keeps that runtime through its backend rounds. Parked confirmations retain the
original arguments and executor. Declining a tool prevents another request for
it in that delegation; duplicate call IDs cannot repeat an action.

Attachments, external links, created documents, reviews, drafts, images, and
tool records belong to the chat. Spoken intent is checkpointed alongside tool
results before final transcript handoff. Browser handoffs remain visible in the
live plan during a call. The lease prevents a competing text turn; ending the
call waits for cancelled tools to settle before releasing it. Browser heartbeats
release abandoned leases after two minutes without contact.

Current-priority recommendations require current task evidence and sent-mail
checks for delivery claims. User corrections take precedence over old plans.
Saved assistant turns are past output, never independent evidence. Calendar
preparation, receipts, and spoken confirmation use the existing
[calendar contract](../../../../lib/calendarScheduler/docs/README.md#chat-and-voice).
Tool results never authorize an action on the user's behalf.

## Live protocol invariants

The browser gathers its SDP offer and the service creates a Live session with
that offer and the trusted configuration. Audio stays on WebRTC. The project
API key stays on the service and recording storage is disabled. Wait for
`session.started` and playback readiness before appending the short opening
cue. A bounded startup timeout releases a stalled microphone and makes the
provider's actual failure available to the user.

Previous chat is labelled as history and keeps its most recent 7,500 UTF-8
bytes, leaving room below Live's 8,192-token startup-input limit even for
non-Latin text. Omitted earlier history is identified explicitly.

Live owns when to speak. Do not restore Realtime `response.create` speech
triggers, VAD settings, audio-buffer clear events, or a speaking-floor manager.
`response.create` now continues only the managed Responses backend. Its events
arrive inside `response.event`; collect custom calls from
`response.output_item.done`, since forwarded lifecycle snapshots have empty
output arrays. Execute each call once. Native PDF/image parts and large text
results go through a trusted Live sideband WebSocket so they are not limited
by WebRTC's SCTP frame size. Submit all matching outputs with
`response.item.create`, then send `response.create` on that same ordered server
connection. The browser waits for every call before requesting continuation.

Speech and backend work are independent. An interruption does not cancel
retrieval or prove a result was heard. Only Live transcript deltas are spoken
history. Preserve fragment text and session timestamps, grouping each speaker
independently so overlapping and delayed captions remain coherent. Grouping
uses a one-second gap in session time; it is a display heuristic, not a model
turn boundary. Drive speaking status from received audio, not backend events.

Ending a call aborts service tools immediately and sends `session.close`.
Keep the connection briefly for final captions, then hand the finished
transcript back to Chat. Late tool results cannot restart the old call. A new
call has a new service identity so delayed cleanup cannot terminate it.
See the [chat design](../../../../service/handler/chat/docs/README.md#voice-in-the-conversation).

Settings exposes Sky's voice only. Auditions use the same Live model,
with no microphone access, notebook context, or processing backend. They send
a generated silent audio track because Live needs active input to advance its
timeline; a receive-only connection can accept instructions yet stay silent. Because
Live has no per-utterance audio-done event, the single-passage preview ends
after received audio and captions have both gone quiet.

Official references: [Live migration](https://developers.openai.com/api/docs/guides/live-migration),
[delegation](https://developers.openai.com/api/docs/guides/live-delegation),
[WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc).
The dated notes below describe the earlier architecture and its investigations.

## Notes

- Test a diagnosis before judging the response to it; weigh saved chats as past output:
  [2026-09-10 — past chats are not evidence](../../chat/docs/2026-09-10-past-chats-are-not-evidence.md)
- Carry questions and answers across speakers and leave room after a reply:
  [2026-09-08 — shared conversation continuity](2026-09-08-shared-conversation-continuity.md)
- Remove the terminal transport while preserving browser calls and previews:
  [2026-09-07 — remove the voice CLI](2026-09-07-remove-voice-cli.md)

- Let both speakers acknowledge their assigned work while retrieval starts:
  [2026-09-07 — research acknowledgements](2026-09-07-research-acknowledgements.md)
- Coordinate Sky's public overview, Sonny's notebook comparison, and Sky's
  synthesis, with identities and resumable speaking stages:
  [2026-09-07 — shared research conversation](2026-09-07-shared-research-conversation.md)
- Fix Astra's custom web-tool choice, preserve research results, and let Sunny
  deliver them without a competing Sky answer:
  [2026-09-07 — research results and the speaking handoff](2026-09-07-research-handoff-and-results.md)
- Verify current priorities and sent mail, and give Sunny the underlying evidence:
  [2026-09-07 — priorities and sent mail](2026-09-07-priorities-and-sent-mail.md)
- Remove task pitches from greetings and simplify the speaking style:
  [2026-09-07 — conversational voice](2026-09-07-conversational-voice.md)
- Require page reads before web synthesis and improve freshness checks:
  [2026-09-07 — reliable web lookup steps](2026-09-07-web-lookup-reading.md)
- Give both research paths working web retrieval and distinguish failed
  searches from missing evidence:
  [2026-09-07 — voice web search](2026-09-07-voice-web-search.md)
- Let Sunny join ordinary conversation and make Sky's replies and handoffs
  more natural:
  [2026-09-07 — Sunny joins the conversation](2026-09-07-sunny-conversation.md)
- Two speech sessions, quick Qwen lookup, iterative Astra research, bounded
  read-only tools, and synthetic live verification:
  [2026-09-07 — two voices with notebook research](2026-09-07-two-voice-research.md)
- Give voice enough context to answer grounded personal questions and
  reason about priorities without searching on every turn:
  [2026-09-07 — voice starting context](2026-09-07-voice-starting-context.md)
- The original proposal, before the implementation above:
  [2026-09-06 — two voices, one conversation](2026-09-06-two-voices-one-conversation.md)
