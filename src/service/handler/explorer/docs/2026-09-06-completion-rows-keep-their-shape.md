---
created: 2026-09-06
updated: 2026-09-06
---

# Completion rows keep their shape

The frontmatter completion menu put the name and its hint in neighboring
grid columns. A long, nonwrapping hint took nearly all the available width,
and the name's `overflow-wrap: anywhere` stacked its letters vertically.
The selected row could fill most of the screen.

Names and hints now have separate lines in the same flexible column. Long
text truncates, with the complete label and hint available on hover. The
menu has a stable preferred width, shrinks to the viewport, and scrolls at
360px or the available vertical space. Selection uses the app's soft blue
colors, with readable secondary text in both color schemes.

Scrolling exposed another detail: selecting the first option before the
hidden portal became visible left the menu at its previous scroll position.
Selection now runs after opening, and again when the result list changes.

Verified with synthetic data in a headless browser: long names and hints,
desktop and 320px/390px phone widths, light and dark themes, a field near
the viewport's bottom, scrolling through results with arrow keys, Enter,
and reopening at the first result. The existing rail browser test now uses
a long job title and allows a compact two-line option.
