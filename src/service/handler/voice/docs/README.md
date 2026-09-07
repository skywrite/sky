---
created: 2026-08-30
updated: 2026-09-07
---

# Voice over the web — service side

The browser talks to OpenAI Realtime directly over two WebRTC connections:
Sky receives the microphone, and Sunny receives text for conversation and
research reports. This handler mints both client secrets around the shared session
configuration (`commands/lib/voice/sessionConfig.ts`) and executes Sky's
tools. Ending a call aborts its running research and rejects late tool
requests. A running tool holds service reloads until it settles.
Routes: `POST /voice/:id/session`, `/tools`, `/end`, and the `/_api/audition`
pair.

The owning voice design and verification notes are at
[ai:voice](../../../../commands/all/ai/voice/docs/README.md), including
[two voices with notebook research](../../../../commands/all/ai/voice/docs/2026-09-07-two-voice-research.md).

- Tool curation and the spoken-confirm gate:
  [2026-08-30 — tools and the spoken confirm](2026-08-30-tools-and-spoken-confirm.md)
