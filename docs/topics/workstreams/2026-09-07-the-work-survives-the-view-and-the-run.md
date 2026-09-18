---
created: 2026-09-07
updated: 2026-09-07
---

# The work survives the view and the agent run

The private canvas made it possible to arrange work but did not carry the work
forward. A name, outcome, and position were insufficient: the user still had to
reconstruct decisions, explain context again, and remember every follow-up.

The main-app implementation puts an evolving workstream record underneath Map,
Timeline, Today, and Sky's execution. A rough objective can be shaped into an
editable starting point. The same work then develops through human edits,
context, decisions, local artifacts, related work, and recurring review.
Optional metadata stays optional. The owner can use one-shot help with ongoing
responsibility off, or give Sky continuing assistance or execution responsibility.

## Preserve one identity through the whole loop

Workstream and activity IDs live in Markdown. A decision has a linked
DecisionDocument whose contents are authoritative; the canvas, Today, and Outbox
read its projection. Document edits participate in revision checks. Expanding an
activity keeps its original reference and daily history while creating an
independently coordinated child. Related work and particular required results
remain distinct, with cycle checks for containment and prerequisites.

A daily row links to the stable workstream/activity identity. Planning saves
canonical participation before projecting the row into the day file. A retry
repairs that projection without making another task. Current-day participation
tracks attributed state changes; historical days retain their snapshots.
Removing a daily row removes the placement, not the work.

## Make ongoing assistance real

The existing scheduler invokes `workstreams:scan`. Manual and scheduled work use
the same operation, model configuration, prompt infrastructure, and executor.
The operation reads current work, selected sources, relevant peer results,
previous artifacts, and outstanding decisions before choosing a useful move.
Changed input or an approaching date can wake it before its normal cadence.
The checkpoint excludes its own bookkeeping so a review does not repeatedly
wake itself.

Each run records its intent and actual result. The executor checks authority and
the work revision under the writer lock before committing a local effect.
Authority lives outside the agent-editable notebook brief. Revocation, changed
context, unmet prerequisites, budgets, interrupted attempts, and ambiguous
results prevent inappropriate continuation. Independent work can continue while
one required result waits.

An artifact is a prepared file. An Outbox item is a communication for review.
The system does not infer that either has been sent, signed, or accepted.
Existing conversation replies reuse their pending intent and preserve edits.
New outreach can enter Outbox locally with no fabricated native destination.
Approval checks linked workstream and decision context before native placement.
Owner reports of sending and an owner's assessment of an identified captured
response produce separate, attributed events.

## Keep the canvas stable while the work changes

Map layout is a display preference stored separately from work revisions.
Timeline represents actual recorded dates; unscheduled work remains visible.
Each view has its own camera. Panning and zooming never alter a work record, and
moving a Map card cannot invalidate an agent's plan. New results refresh the
selected work while preserving the person's position.

Reports use each audience's permitted source set before generation. Sensitive
access and level of detail are independently configured. Markdown preparation,
slide outlines, and recording outlines are useful results; a missing native
presentation or recording remains an explicit input rather than a fabricated
completion.

Deterministic tests exercise persistence, concurrent edits, source changes,
revocation, cycles, effort limits, interruption recovery, audience boundaries,
canonical decisions, daily participation, Outbox intent reuse, and the camera's
interaction invariants. Browser checks exercise the same main-app surface.
