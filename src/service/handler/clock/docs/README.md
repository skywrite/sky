---
created: 2026-08-30
updated: 2026-08-30
---

# Clock — notebook time against the world's

Design notes for `src/service/handler/clock/` and the page it serves,
`theme/client/clock.tsx`.

## What is built

The notebook clock sits beside "sky" at the top left of every page —
one line normally, a second orange system line when the two diverge.
Clicking it opens `/clock`: an input on top, the pinned Notebook and UTC
clocks under it, then a list of common regions.

- `mod.ts` — the wire types and routes. `GET /clock/_api/now` is one
  snapshot of both clocks; `POST /clock/_api/convert` relays a raw line
  to `util:tz:convert` and answers with its three rows (local, target,
  UTC).
- `createClockHost.ts` — production wiring: a fresh server
  `CommandContext` per request, so notebook now is read the way every
  command reads it, and a conversion is an in-process command run, model
  call included.
- `theme/client/clock.tsx` — the page and the ambient sidebar clock.
  The client ticks per minute from the snapshot (the notebook day plus
  its zone are enough to reproduce extended hours) and refetches on
  focus and every few minutes, so a `day:start` elsewhere shows up soon
  after.

## The rules it lives by

- Notebook time is shown as written. `32:07` the morning after an
  unstarted day is a real time, filed under the day it belongs to; the
  calendar reading is the annotation, never the other way around.
- One input, two jobs: plain text filters the region list; a 500ms
  pause (or Enter) sends the raw line to `util:tz:convert` when the
  line reads like a question or names an unlisted place. The model
  does the reading — the client parses nothing — and the answer lands
  as rows in the same table, dimmed while a newer ask is in flight.
- The second clock appears only on divergence, and the cause is spelled
  out (day not started; machine moved, day still in the old zone).
- The region list is a fixed set in the client for now. Deriving rows
  from people, meetings, or travel was mocked and parked; see the
  session's design artifacts before growing this.

## Verified

2026-08-30: route tests (`clockRoute_test.ts`), `bun run dev:check`,
plus a live run — `/clock/_api/now` against the running service, one
real `convert` round trip, and the page in a headless browser.
