---
created: 2026-09-01
updated: 2026-09-01
---

# Chat over HTTP — a thread, its tuning, and the story of its context

Design notes for `src/service/handler/chat/` and the page that drives it,
`theme/client/chat.tsx` with `controls.tsx` and `context.tsx`.

## What is built

A thread is a ChatSession kept in memory for the life of the service. A
message is a POST whose response is the turn's event stream; the page
renders the same events the terminal renders. Around that, three things
a person can see and touch:

- **The model a thread thinks with and how much it reads.** Both sit under
  the composer, beside the files-in-context count: `Opus 5 ▾` opens the
  configurations from Settings › AI grouped by provider, with the role
  each one holds; `Reads up to 300k ▾` offers the reading budget in stops.
  Both apply from the next message. `GET /chat/:id/settings` answers the
  tuning — the thread's own, else what was chosen before its first
  message, else the host's defaults (the Thinking role, ai:chat's 300k).
  `POST /chat/:id/settings` with `{ profile?, contextTokens? }` changes it:
  a live thread swaps the model for its next turn and reassembles its
  context under a new budget at once; a thread not yet built keeps the
  choice for when its first message builds it.
- **The context, turn by turn.** The Context panel opens with the story:
  the notebook read at the start (files found, how many fit),
  what a later question brought in, what the budget pushed out to make
  room, what the model read by tool, and the step under way while a reply
  is prepared. `GET /chat/:id/context` carries it as `log`, derived in
  `timeline.ts` from the session's context log — each entry ships only
  its change, never the universe again.
- **What the model sees now**, below the story, folded: every document in
  context with its tokens, what was left out and why, and the hand on it
  (pin, drop, let back, pin a file by path). As before.

The `timeline.ts` derivation: the seed entry counts what the baseline
gathered (the deduplicated universe, never the raw sweep sizes); a grown entry lists the documents its queries added (cut ones
included, marked) and the documents kept before that the budget cuts now;
a quiet turn carries the previous cuts forward, so a document cut two
turns ago is not pushed out again; a broken turn keeps its errors.

## The rules it lives by

- A change mid-turn is refused (409): the model is read when a turn
  starts, the budget when the context is rebuilt. The page keeps both
  controls out with the composer while a turn runs.
- The transcript records one model — the one answering when it is saved.
- The wire never carries the whole universe twice: the stream carries
  counts, the context route carries the current records and the story's
  changes.
- The count shown anywhere is the latest assembly's. A pin, a drop, or a
  new budget reassembles between turns without a log entry, so the routes
  read the last rebuild report before the log.

## Verified

- 2026-09-01 — route tests: defaults before the first message, a choice
  kept for the thread and recorded in the turn log's budget, refusals
  (unknown model, zero or non-numeric budget, empty body), a smaller
  budget on a live thread cutting documents at once and every count
  agreeing; timeline tests over synthetic logs.
