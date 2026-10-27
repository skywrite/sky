---
created: 2026-09-06
updated: 2026-10-27
---

# Open work

One file per item: what is wrong or missing, the shape of the fix, and
what it trades. Written when the item is named, not when it is built.
When an item ships, its file goes, and the subsystem's own docs carry the
story from there.

- [The client build's retry leaves with Bun's resolver fix](bundle-retry-leaves-with-bun-fix.md) —
  `web/bundle.ts` builds the client once more when a build only failed to
  resolve files, around a `bun test` bug (oven-sh/bun#22941); it goes once
  a Bun release carries their PR #36245.
- [Days start and close by themselves](days-start-and-close-themselves.md) —
  the first act after hours away starts the day, a tidied day closes
  itself; agreed as the direction, parked after the buttons moved.
- [Chat context improvements](chat-context-improvements.md) — better
  retrieval decisions, clearer activity, and smaller context where useful.
- [Machine-bound commands move to sky-extras](commands-to-sky-extras.md) —
  `util:desktop:rename` and its kin leave the public CLI for a repo of
  optional commands that does not exist yet.
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

## Maybe later

- [Spelling and grammar checking](maybe/spelling-and-grammar-checking.md) —
  built-in suggestions for the shared editor; engine options, integration
  considerations, and preliminary effort estimates.
