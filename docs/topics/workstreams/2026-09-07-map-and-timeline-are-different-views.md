---
created: 2026-09-07
updated: 2026-09-07
---

# Map and Timeline are different views

The design used “canvas” and “timeline” interchangeably. A simplified empty
mockup then removed useful surrounding controls, pinned the week ruler while
panning the work surface, and gave newly created workstreams no object-drag
behavior. A blank starting state had become a different and less capable
interaction, losing parts of the accepted prototype.

The intended experience has two spatial views of the same work. Map gives
workstreams free positions and explicit relationship links. Timeline organizes
their activities against weeks. Moving a Map card expresses visual organization;
moving a scheduled Timeline activity changes its planned timing. The two kinds
of position must be stored separately.

Both views retain the established camera gestures. Dragging an object with the
select tool moves it; Space-drag, the middle button, or the hand tool pans the
view. Each view remembers its own camera. Selection and record identity carry
across the view switch, while context remains accessible alongside the work.

The empty state is one prominent add action inside this interface. It does not
replace the interface or remove access to existing work. Earlier examples remain
available as a separate preview, and records added during the empty-state trial
must be preserved. The revised temporary mockup restores the previous timeline
and adds Map using shared workstream records and separate layout preferences.

The README now names the two views and their interaction contract explicitly.
Production workstream integration remains unimplemented; prototype drag behavior
must not be presented as changing real schedules or running an agent.
