---
created: 2026-09-18
updated: 2026-09-18
---

# A dragged row travels whole

Dragging a grip used to move nothing. The row dimmed where it lay, and a
thin line marked the drop between two other rows. The pointer travelled
alone. On the phone the finger covered the only thing that changed.

Now the row comes along. The grip lifts a copy of the entire row: its
control, its time, and its text, wrapped exactly as it was. The copy stays
under the pointer or the finger. The row itself waits in the list as an
empty slot, and the rows between step aside, so the slot is always where
the row will land. On release the copy glides into the slot. The saved list
then takes its place in the same paint, so the row is never seen twice and
never missing.

## Choices

**A copy, not the row.** The row lives inside cards and a scrolling column
that would clip it. A copy of its markup, fixed to the window, floats over
all of them and keeps the wrap, because it keeps the width. It is inert and
hidden from assistive tools; the grip's arrow keys remain the keyboard path.

**Cut from the same paper.** The copy takes the background it lay on: the
page, or the tint of Most important. It lands without a seam in light and
dark. A bare row gets a small margin of paper around it. An Organize row
already has its own.

**The ground does not move.** Landings are measured once, when the row
lifts, from the list at rest. Each landing knows how far the slot sits from
home and which rows make room. The pointer's travel, plus any scrolling
since the lift, picks the nearest landing. Rows sliding aside are only
transforms, so they never change what the pointer is read against, and
rows of different heights cannot make the slot flicker.

**Only the same list.** Landings exist beside rows of the row's own
Markdown list, as before. Rows of another list that happen to lie between
step aside with the rest.

**The save waits for the landing.** The reorder request leaves at release.
Its answer is held until the copy is down. A failed save puts the row back
and says why in the usual place.

**Calling it off.** Escape, a cancelled touch, or a lost pointer sends the
copy home and saves nothing. Dropping a row in its own place saves nothing
either.

**Edges.** Holding the copy near the top or foot of the column still
scrolls it. A row picked up beside an edge now stays put until the pointer
heads for that edge, so the list no longer runs away at the first touch.

**No ring after a drop.** Every reorder used to hand focus to the grip, so
a mouse drop ended with a focus ring around it. Focus now returns to the
grip only when the arrow keys moved the row, where the next press needs it.

Reduced motion keeps the copy under the pointer and drops the slides, the
lift and the glide.

## Checked

`http-day-organizing-e2e_test.ts` drags with a mouse on the desktop layout
and with touch on the phone layout. Mid-drag it finds the whole row's text
under the pointer, as wide as the row, with one slot in the list. After the
drop it finds no copy, no row standing aside, no focus on the grip, and the
file in the new order. On the desktop it also presses Escape mid-drag and
finds no request, no change to the file, and nothing left floating. After an
arrow-key move it finds the focus still on the moved row's grip.
