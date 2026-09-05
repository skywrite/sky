---
created: 2026-08-30
---

# Voice over the web — service side

The browser talks to OpenAI Realtime directly over WebRTC; this handler
mints the client secret around the shared session configuration
(`commands/lib/voice/sessionConfig.ts`) and runs every tool call the
model makes. Routes: `POST /voice/:id/session`, `/tools`, `/end`, and
the `/_api/audition` pair.

- Tool curation and the spoken-confirm gate:
  [2026-08-30 — tools and the spoken confirm](2026-08-30-tools-and-spoken-confirm.md)
