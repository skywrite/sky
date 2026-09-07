---
created: 2026-09-06
updated: 2026-09-06
---

# Gmail reads must identify missing context

A long thread exhausted the 24,000-character body budget from oldest to
newest. A short correction at the end could disappear with no indication
that the returned conversation was incomplete. Allocating the same budget
newest-first keeps the correction and its recent context; reversing the
selected messages preserves chronological reading order. Counts report
omitted messages, and thread/per-message flags report shortened bodies.
Reaching a cap exactly does not by itself mean anything was truncated.

The inbox view also shared label synchronization with capture/follow
operations. Restricting synchronization to user labels protected INBOX
and UNREAD, but viewing a custom label could still write to Gmail. The
view now explicitly disables synchronization. Capture callers retain
their existing user-label behavior, which keeps new replies discoverable
under the bucket after archiving.

New draft creation used composition depth alone to enable the account
picker. A service call at depth zero could therefore open a terminal
prompt. It now requires the console platform too, matching read/view
and the other draft commands. Command tests use synthetic accounts and
mock HTTP responses to cover ambiguity, label totals, timestamp precision,
read-only requests, and returned draft ids without accessing real mail.
