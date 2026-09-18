---
created: 2026-09-07
updated: 2026-09-07
---

# Connect capture, Today, Sky, and Outbox

The earlier proposal described a durable workstream and carefully limited agent
execution, but its starting point was already organized work. It did not make the
path from a rough objective to the next useful activity easy to follow. Its first
milestones deferred daily write-through, and it predated the implemented Outbox.
A timeline prototype helped explain relationships and activity scope, but did
not establish how someone would use the product to advance real work.

The missing contract spans the whole journey: capture intent, clarify enough to
act, reuse or create a workstream, choose a next activity, carry it into Today,
let Sky help, handle communication in Outbox, and bring results back. Each part
needs a distinct responsibility and references to the same work. Repeatedly
rephrasing the concept or asking for detailed business inputs does not substitute
for specifying this connection.

The revised README makes that journey the first release target. It uses a
fictional pilot-scope example that can be exercised with deterministic sources,
model results, and provider fixtures. The person can still do all the work by hand;
metadata and delegation remain optional. A proposed activity can grow into a
workstream later, preserving references instead of creating duplicate work.

Outbox changes the implementation opportunity, but its current guarantees matter.
It processes saved conversations and supports explicit review followed by native
draft placement. Its Ready state is not evidence of sending. The first workstream
integration links an existing captured conversation and pending reply; general
workstream-originated outreach needs its own producer and intent identity later.
The workstream preserves the intended result and actual progress while Outbox
preserves the communication and its review/handoff history.

Today write-through and one real Sky action now belong in the first complete
slice. Scheduled responsibility follows by invoking the same operation, with
persistent limits and recovery. This ordering replaces the earlier sequence of
human-only groundwork followed by an isolated agent pilot and unspecified later
integration. The next coding task is a persistent workstream activity linked to
Today; the release is not complete until the agent and linked Outbox portions of
the same example also work.

This is a proposed spec revision. It changes no runtime behavior, enables no
automation, and creates no workstreams in a personal notebook.
