---
created: 2026-09-07
updated: 2026-09-07
---

# Shared actions and dialog styling

Sky had two paths to the same blue: Mantine's primary palette and CSS values
that named blue directly. Buttons also repeated `variant="light" color="blue"`
throughout the client. A change to the global primary color therefore left
many controls behind. Dialogs shared Mantine behavior but repeated padding,
radii and bottom-sheet layout, and attachment confirmations depended on
shared presentation rules living in the import stylesheet.

Action roles now resolve in the existing Mantine theme. A primary action and
its quieter counterpart follow `primaryColor`, as do the semantic CSS accent
values. Secondary, destructive, warning and Outbox delivery actions have
explicit roles, allowing a family to be tuned in one place. Ordinary Mantine
variants remain available for neutral toggles and deliberate surface choices.
There is no wrapper around the button implementation, so polymorphic links,
loading, disabled states and focus handling retain Mantine's behavior.

Modal and Drawer defaults assign shared classes that also work inside portals.
Their surface, title, spacing, radius, actions, footer and mobile sheet styles
live in `dialogs.css` and use `tokens.css`. A feature can still choose its width
and dismissal behavior. The meeting composer keeps its scrolling inner body
and fixed footer; those consume shared spacing instead of redefining it.
The bottom-sheet rules respect both automatic and explicit heights.
They explicitly fill the available width: overriding the Drawer's flex sizing
without setting its width otherwise lets a short sheet shrink to its content.

The app remains the visual reference. Verification uses synthetic content in
temporary files and the existing browser suites, rather than maintaining a
second theme showcase that can drift from the actual components.

## Verified

2026-09-07: `bun run dev:check` passes. The shell/bundle route tests and the
existing meeting, link and attachment-picker browser checks pass (six tests).
The meeting checks cover its desktop and full-screen phone layouts, including
the scrolling body and reachable action footer.

A temporary browser fixture changes one primary palette value and verifies
buttons, icon buttons, quiet actions and custom CSS accents in light and dark
mode. It also checks that status/delivery colors and disabled/loading behavior
remain intact; CSS token changes reach modal padding, title size and radius;
feature classes compose with shared classes; Escape closes and restores focus;
and automatic-height and explicit-height mobile sheets fill the screen width
and stay within the viewport. Screenshots were inspected outside the repository.
