---
created: 2026-09-07
updated: 2026-09-07
---

# The canvas is the workstream view

The zoomable timeline prototype made relationships and the scope of work easier
to understand. Its free panning and zooming became an accepted part of the product
direction. The execution spec nevertheless deferred timeline implementation while
prioritizing persistent records, Today, Sky, and Outbox. That left the visual
experience disconnected from the first usable product.

The revised design makes the canvas the primary workstream view. A person can
zoom out to understand outcomes and relationships, move closer to activities and
decisions, and select work to inspect context or take the next action. The first
implementation includes a modest canvas connected to persistent records, followed
by Today write-through, one real Sky invocation, and linked Outbox review.

This choice does not add another work hierarchy. Lanes identify workstreams;
clips represent activities or linked work. Zooming reveals detail. Promoting an
activity into a workstream is a separate decision about its coordination needs.
Today and Outbox continue to reference the same work, with their own participation
and communication histories.

A timeline must also accommodate work whose timing is unknown. Undated work has
a visible unscheduled area; only recorded dates and ranges occupy the time scale.
Camera and layout preferences do not establish commitments. This preserves the
ability to begin with a simple outcome and a few activities.

The interaction quality is part of the requirement: smooth zoom around the
pointer, unrestricted panning, discoverable keyboard controls, and a camera that
stays put when work updates or details open. Sky's existing shell and visual
identity remain the foundation. Agent involvement is visible through actual
assignments, attempts, results, and requests for judgment.

The first implementation check is now a persistent activity shown and editable
from the canvas. The next check links it to Today and observes the same result
after a restart. Advanced schedule editing can follow this complete loop. This
revision changes the spec only; the temporary prototype is still a design
reference, and production workstream integration remains to be built.
