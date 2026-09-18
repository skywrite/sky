---
created: 2026-09-04
updated: 2026-09-04
---

# Outcomes before delegation

Status: rationale for a revised proposal, not an implementation report.
All examples are synthetic. The current contract lives in [README.md](README.md).

## The problem

The initial proposal defined workstreams around delegation and required an
execution policy to activate one. That made ordinary human work depend on
capabilities Sky might not have. It also coupled an agent's budget or permission
stop to the lifecycle of the whole outcome.

The missing everyday model was continuity: an outcome survives the week's plan,
with a next step, a record of progress, and commitments between people. A person
should get that value while performing every action themselves.

## What changed and why

The workstream now owns an outcome and its current plan. A person owns keeping
it moving; action assignment, available capability, and execution authority are
separate. Selected actions or coordination can be delegated later. Losing Sky's
authority stops affected execution without pausing independent human work.

The week remains the shared ranked plan, and days record participation and
results. Workstreams feed those views with canonical actions. Owed-by and
owed-to metadata describe commitments that executor assignment alone misses.
Reconciliation should reduce duplicate upkeep while preserving the distinction
between a reported result and an independently observed one.

The pilot now proposes embedded action records in one workstream document.
Separate action files were considered for durable identity and cross-workstream
references, but neither requires that storage layout. Stable IDs can resolve to
embedded records. One brief is simpler to edit for human-led work; extraction
can be considered if volume or independent editing warrants it. Agent artifacts
and detailed run records remain separate, and multi-file recovery is still
required when those are written together.

## Boundaries retained

One outcome may have several acceptance criteria. Sentence count, duration, and
the number of participants do not decide whether it is a workstream. Completing
every action cannot substitute for evidence that the outcome is achieved.

A human completion report can satisfy a criterion that calls for that report.
Stronger criteria still require stronger evidence. Derived assessments may be
stale or incomplete; missing evidence does not mean the work is on track.

Execution policy enforcement, immutable identity, revision checks, attributable
results, and recovery remain requirements for agent work. A cloud draft is an
external effect even if it is never sent. Human-led use ships before a local,
manually invoked execution pilot; scheduling and external adapters follow only
after that behavior is demonstrated.
