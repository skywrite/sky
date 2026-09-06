---
created: 2026-09-05
updated: 2026-09-05
---

# The day file becomes an icon

The day's header held two buttons on its right: Day file and Details.
Day file opened the day's own markdown in the explorer. Details toggles
the rail. Two words in boxes for two different things: one is a link to
the file behind the page, the other is a view control.

The ask was to make the link a little file icon next to the date, so the
header carries less text. That is where it belongs. The file is the
date's own record, so its control hugs the date, the way a row's action
sits right after its text and never at the far edge. Details stays alone
on the right.

What changed: the date span is a flex row holding the label and a small
page glyph, a Mantine `ActionIcon` rendered as a link. The words "Day
file" did not vanish. They are the link's accessible name and its hover
hint. The icon is dim until hovered, then takes the text color and the
subtle hover square every icon button here has. On phones the date wraps
and the icon follows its last word.

Considered and not done: a tooltip component, since a native title is
enough for a hint and adds nothing to the bundle; a smaller text link,
since the ask was to remove text; and the icon in the button row, where
a glyph at the far edge would be a mystery button. Beside the date it
reads as this date's file.
