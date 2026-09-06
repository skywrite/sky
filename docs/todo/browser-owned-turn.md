---
created: 2026-09-06
updated: 2026-09-06
---

# The browser owns the chat turn

## The problem

The web chat's turn runs inside the service: the page posts a message,
the service calls the model, runs the tools, and streams the reply back.
The service restarts often while Sky is being built — every code save
under it, until 2026-09-05 — and the turn lives in the process that
restarts. Restarts now wait for turns to end (`src/service/reload.ts`),
and a kept thread comes back knowing what it was asked, but a forced
restart or a crash still takes the reply in progress, and the design put
the fragile thing in the one place guaranteed to break. Voice never had
the problem: the browser talks to the model directly, and the service only
serves the tool calls.

## The shape of the fix

The page runs the model call itself with the AI SDK. The chat engine is
host-blind already (`_shared-ts/models/Chat/ChatEngine`) and can run in
the browser with a fetch to the provider underneath it.

The service becomes the notebook's API for the turn: it assembles and
hands over the context, executes the tool calls the model makes through a
tools route shaped like voice's, holds approvals, and receives the
finished turn to file and snapshot. Everything that must touch the
notebook stays on the machine; nothing that must survive a restart stays
in the process. A restart mid-turn then costs at most one tool call, as in
voice, and the reply keeps streaming.

The terminal keeps its in-process session as it is.

## What it trades

- The provider key reaches the browser.
- The turn dies if the tab closes; today a turn outlives the page and can
  be followed from another device.
- The day list follows only what the page reports back.
- Two hosts run the engine; they must stay in step.

A few days, most of it the tools route and the hand-back of the finished
turn. Named 2026-09-06; the design comes before any code.
