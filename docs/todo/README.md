---
created: 2026-09-06
updated: 2026-09-06
---

# Open work

One file per item: what is wrong or missing, the shape of the fix, and
what it trades. Written when the item is named, not when it is built.
When an item ships, its file goes, and the subsystem's own docs carry the
story from there.

- [The browser owns the chat turn](browser-owned-turn.md) — the web chat's
  model call moves out of the service process, the way voice already runs.
- [The turn in a worker process](turn-in-a-worker.md) — the other way to
  make a reply outlive a service restart, keeping the current shape.
- [The chip names its subject at call time](chip-subject-at-call-time.md) —
  a running mission's chip says what it is doing, not only after.
- [A waiting import survives a restart](import-survives-a-restart.md) — an
  import stopped to ask the person is re-asked after a restart, not failed.
- [Voice tool calls wait through a restart](voice-tools-retry.md) — the
  voice page retries a tool call the service missed while away.
