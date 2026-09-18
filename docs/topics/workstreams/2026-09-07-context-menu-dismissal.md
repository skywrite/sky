---
created: 2026-09-07
updated: 2026-09-07
---

# Context menu dismissal follows pointer input

The menu could close with Escape and execute actions, but clicking blank canvas
left it open. The canvas prevents the default pointer-down behavior while
beginning a pan. That suppresses the compatibility mouse-down event used by
Mantine's default outside-click listener. The original browser checks exercised
keyboard dismissal but missed this interaction between the menu and canvas.

The menu now listens for outside pointer-down events. Canvas panning retains its
existing event handling. A dismissed menu returns keyboard focus to its trigger
only when focus has not already moved to another control; clicking the search
field must leave the field ready for typing.

Phones retain the bottom Drawer with explicit backdrop dismissal. Tapping its
dimmed backdrop or close button closes it without selecting or deleting work.
The browser regression exercises desktop canvas and input dismissal, mobile
backdrop and close-button taps, and the existing menu actions and Undo flow.
