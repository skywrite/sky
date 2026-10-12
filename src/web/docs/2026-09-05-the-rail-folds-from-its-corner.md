---
created: 2026-09-05
updated: 2026-09-05
---

# The rail folds from its corner

The Details rail beside a day, and beside a document, opened and closed
from a Details button in the page header. On a narrow window the rail
was an overlay with its own × at the top right. Two controls in two
places for one pane, and a word in a box in a header that had just lost
its other word (see `2026-09-05-the-day-file-becomes-an-icon.md`).

The ask: make the pane collapsible, drop the button, and give the pane
a tiny arrow in its top-left corner that points right. Folded, the arrow
turns and brings the pane back.

What was built: one chevron. Open, it sits in the rail's corner and
points at the edge the rail folds into. Folded, the same chevron waits
at the end of the page's header, where the Details button stood, and
points back at where the rail was. It carries "Hide details" or "Show
details" as its accessible name and hover hint, and `aria-expanded` for
the state. Escape still closes the overlay. A wide window still
remembers the choice.

Where the folded chevron waits was the one real choice. Pinned to the
window's right edge it would keep the fold exact, but on a phone the
header's first row has to keep its height beside the menu button, and
the content's edge is where the eye already is. The header's end does
both without positioning. A folded strip, a thin gutter with the arrow
at its top, was heavier than the day it would sit beside. The rail's
"DETAILS" title went with the button: its sections carry their own
headings, and the aside keeps the name for assistive technology.

`railToggle.tsx` holds the chevron. Both rails render it in their head,
and both pages render it at the header's end while folded. The import
page's inline copy of the document rail, under a heading of its own, has
no head at all. On a phone the menu button floats over the overlay's
corner, so the head steps aside for it. The hook in `rail.ts` lost its
`close`: one toggle does the work on every width.
