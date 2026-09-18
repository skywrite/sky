---
created: 2026-09-07
updated: 2026-09-07
---

# A workstream menu with recoverable deletion

The canvas made work visible but offered no direct way to remove a workstream.
A context menu belongs to each workstream, wherever it appears. Desktop users
can right-click; keyboard and touch users have a visible three-dot button. The
same actions become a bottom sheet on narrow screens, without competing with
the canvas's touch panning and pinch gestures.

The desktop menu anchors to a fixed point in the viewport. That one-pixel anchor
is intentionally independent of the card, so Mantine's detached-reference hiding
is disabled; normal flip and shift positioning keep the actions visible at the
edges. Closing the menu restores focus to its trigger, or the canvas when a
Browse entry has closed with its dialog.

Deleting a workstream has consequences beyond removing a card. It may have
running Sky preparation, delegated authority, canonical decisions, daily links,
and other work depending on its results. Permanent folder removal would lose
that context and could leave a running operation acting on stale information.

Deletion retains a durable record and revokes ongoing authority. Normal reads
hide deleted work, normal writes cannot resurrect it, and a required result
from deleted work does not unblock another activity. Related workstreams and
children survive. Internal relationship validation retains the old identity so
the remaining work can still be edited without stripping its relationships.

Undo refers to a specific deletion event. It restores the original identity and
content, with Sky off; an old Undo cannot undo a newer deletion. The menu retains
the revision that was visible when opened, so a background update cannot turn
the user's earlier selection into permission to delete revised work.

Verification covers revision conflicts, interrupted or repeated operations,
authority revocation, retained relationships and records, desktop right-click,
keyboard access, mobile actions, and camera behavior through deletion and Undo.
