---
created: 2026-09-03
updated: 2026-09-03
---

# An item can leave the day

The day page could mark an item done and could put it back. It could not
take one off. A to-do added by mistake, a reminder that no longer applied,
a commitment that fell through — each stayed on the page until the day
file was opened and the line cut by hand.

Now a row has a way off. On a desk, resting the pointer on a row shows a
small × right after the item's text; clicking it takes the item off the
day. On a phone,
where nothing hovers, the row swipes left the way a mail row does: a short
pull bares a red Delete and holds it there until it is tapped or anything
else is touched; a long pull deletes on release. Either way the row folds
shut without a strike, and the same pill that follows a check-off says
"Deleted" with Undo, for eight seconds.

## What the file does

The line leaves the day file; nothing else in the file changes. The edit
is `DayDocument.deleteItem`, a line edit beside `toggleItem`, addressed the
same way — by list heading and by the item's text with strike marks
ignored — so a stale page misses instead of deleting a neighbour. The
answer carries where the line stood in its list, and Undo hands that back
to `restoreItem`, which puts the line at that place. In the usual case the
file after Undo is byte for byte the file before the delete.

When the item was its list's last, the heading does not lose its list. The
line becomes a bare `-`, which is what the day template writes for an empty
list and what `removeEmptyLists` removes at the day's end. Without it the
heading would stop parsing as a list, and the next `day:items:add` aimed at
it would land in a neighbouring list — a fact checked against the model
before this was written. Restoring into such a list replaces the slot.

## What it does not do

Done today rows have no ×: a struck plan item goes back to its list with
its checkbox, and a Complete-list entry is the day's own record. Streaks
are not items in the day file. The terminal has nothing new; the CLI's
list commands stand as they were.
