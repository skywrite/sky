---
created: 2026-09-07
updated: 2026-09-07
---

# A brief, direct relationships, and one conversation entry

The sidebar exposed nearly every workstream capability at once. Outcomes,
activities, Sky controls, reports, and metadata competed for attention. The canvas
drew links, but discarded their explanations and contribution type. Creating a
relationship required opening a general details form. Sky could propose several
relationship kinds, but accepting one could reduce them to generic related work.

The default Brief now presents the outcome, situation, next item needing
attention, Sky's actual work, and nearby relationships. Work and Details hold the
complete lists and configuration. Opening an activity reveals its context and
secondary actions. Long prose expands without making the initial brief a wall
of text. The next move respects recorded prerequisites.

Relationship handles, context menus, and the Brief all open one editor. It
distinguishes contribution, related work, containment, and a specific required
result. Links can be inspected and removed directly. The owning record receives
a revision-checked patch; neighboring work remains independently editable.
The store rejects containment and prerequisite cycles, missing references, and
removing an activity another activity requires. Contribution cycles are allowed.

Sky proposals retain their relationship kind and activity/result references.
They appear provisionally on the selected canvas and use the same editor for
review. Incomplete prerequisites need their exact result selected before
acceptance. Reviewed changes and proposal removal are saved together. Incoming
contributions and required-result links are included in observation fingerprints
so recorded changes can wake the work they affect.

One composer accepts context and requests. Sending saves the context and asks Sky
for a one-shot review; saving a note alone starts no review. Stable operation IDs
make context retries safe after a lost response, including concurrent retries.
The existing responsibility settings continue to govern ongoing work.

Verification uses synthetic notebooks and the real HTTP/store/browser flow:
relationship drag, editing and removal, exact prerequisites, proposal acceptance,
mobile actions, context retries, and existing Today, Outbox, decision, reporting,
Delete, and Undo behavior. Temporary visual checks also inspect the live app
without changing notebook records.
