---
created: 2026-09-07
updated: 2026-09-07
---

# Clips belong to the composer

Pending file clips originally rendered directly under the full-width composer
zone. The message row was a separate, centered container capped at 1000px.
On wide windows, an attachment therefore sat at the far left of the page while
the input started much farther right. Successful upload and viewport-overflow
checks did not catch that visual separation.

The centered composer now owns one rounded input surface. Pending files live
inside it above the row containing the text and existing action controls.
The surface retains Sky's color tokens and focus treatment; file cards use
the page background to distinguish themselves within it. Errors also belong
to the centered container. File lists have a bounded scrolling height, and
shortened filenames expose their complete name on hover.

The browser check now measures the pending clip's position against the input
surface at both 390px and 2240px viewport widths. It checks containment,
placement above the text, and visibility of the remove control, and captures
the pending state at both sizes for visual review. File submission, removal,
and the voice handoff continue through the same existing browser tests.
