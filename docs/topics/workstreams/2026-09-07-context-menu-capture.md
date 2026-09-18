---
created: 2026-09-07
updated: 2026-09-07
---

# Outside dismissal observes capture and click activation

The first dismissal fix changed Mantine's outside listener to `pointerdown`.
Fresh-browser checks passed for ordinary canvas clicks, but the user still
reported a menu staying open. Those checks did not establish the cause of that
specific report. Further testing exposed two remaining gaps: click activation
without a pointer event, and pointer events whose bubbling is stopped.

The desktop workstream menu now owns document capture listeners for
`pointerdown` and `click`. Events whose composed path includes the dropdown stay
inside; other events dismiss it without preventing their destination's action.
Mantine still owns positioning, keyboard navigation, and Escape. Its duplicate
outside listener is disabled. The mobile Drawer retains its backdrop behavior.

A temporary browser bundle using the earlier handler failed both additional
cases; the revised handler passed them. The integration scenario also exercises
outside dismissal from Map cards, Timeline lanes and clips, and detail headers,
using both right-click and ellipsis entry points. Selection, camera, revisions,
inside-menu Delete/Undo, and mobile dismissal remain checked. Live checks use
read-only navigation; no workstream records are changed.
