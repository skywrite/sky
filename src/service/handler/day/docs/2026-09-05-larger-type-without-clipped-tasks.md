---
created: 2026-09-05
updated: 2026-09-05
---

# Larger type without clipped tasks

The first typography pass gives Today and Explorer a shared content size:
19px on desktop, 18px in the narrow layout. While checking wrapped tasks,
the day row's existing `max-height: 64px` cut off text. A two-line desktop
task needed 77px including padding; a longer phone task needed 131px.

The height cap had been the starting point for the collapse animation.
Increasing it would only move the clipping threshold. Rows now grow to
their content. An actionable row has one grid track that transitions from
`1fr` to `0fr`, and its inner row can shrink to zero. Existing strike,
delete, response, and undo timing stays in the day component. Streaks and
Done today rows also have no height cap.

The swipe layer remains positioned behind the inner row. Reduced-motion
mode skips the CSS transition. The change concerns text fitting and the
visual collapse; item writes and their recovery behavior stay the same.
