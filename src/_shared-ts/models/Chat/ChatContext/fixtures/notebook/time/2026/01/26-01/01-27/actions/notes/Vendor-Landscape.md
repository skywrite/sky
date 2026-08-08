# Vendor Landscape

Notes from the quarterly pass over the tooling and vendor landscape, covering what we renewed, what we dropped, and what is worth a closer look next quarter.

## Renewals

The observability stack stays as-is for another year. Pricing held flat after the usage commitment was renegotiated, and the on-call team rated it the tool they would least like to lose. The incident-review tooling also renews, though the seat count drops by a third to match actual weekly active use rather than the original optimistic rollout plan.

The design toolchain consolidates onto a single vendor. Two overlapping subscriptions were doing the same job, and the export-format lock-in turned out to be weaker than feared once the migration script was written. The savings are modest but the maintenance surface shrinks, which was the real motivation.

## Dropped

The survey platform goes. Response rates never justified the cost, and the two teams that used it have already moved to lightweight forms backed by the existing data warehouse. The transcription add-on also goes — the built-in capture pipeline caught up to it feature-for-feature over the last two quarters and runs at a fraction of the cost.

One borderline call: the standalone diagramming tool. Usage is concentrated in two people, but those two people use it every day and the export quality is genuinely better. It survives this round with a note to revisit if the seat price climbs again.

## Watching

Three categories are worth a closer look next quarter. First, the contract-analysis space has matured quickly; Nimbus and two smaller entrants now cover clause extraction well enough that the manual review backlog could shrink meaningfully. Second, the data-quality monitors: the current homegrown checks catch schema drift but not distribution drift, and the build-versus-buy math is tilting toward buy as the pipeline count grows. Third, workflow automation for the operations queue — the glue scripts have become load-bearing, and a supported product with an audit trail would retire a category of silent failures.

The overall spend trend is flat year over year once the dropped tools offset the renewals, which is where it should be while the team size holds steady.
