---
created: 2026-09-09
updated: 2026-09-09
---

# Recover a saved camera that shows no work

A saved camera can point away from every workstream. The count and canonical
records remain correct, but the canvas looks empty. Revealing a newly created
or selected card fixed only the detail route: entering `/workstreams` without a
selection still restored an empty viewport.

Map and Timeline now check for visible work once on entry, after records and
usable viewport dimensions are available. They preserve useful saved cameras;
otherwise they fit the work. Visibility uses actual cards, lane labels, and
activity clips, rather than the empty space inside their combined bounds. If
widely separated work still falls outside the viewport at minimum zoom, a real
card is revealed instead.

Recovery is consumed for that entry. Polling, Sky updates, and resizing cannot
undo a person's subsequent pan or zoom. Opening or closing details and switching
views establish a new entry. Pending camera updates are saved to their outgoing
view before loading the other view's preferences.

The browser regression first reproduced the failure with an existing card at
negative coordinates and an offscreen saved camera. It checks the full rectangle
against the canvas and hit-tests the card's center: DOM presence or Playwright's
`isVisible()` can report success for an element clipped outside the canvas.
Coverage includes unselected reload, return from details, separate Map/Timeline
cameras, and deliberate navigation surviving a status refresh.
