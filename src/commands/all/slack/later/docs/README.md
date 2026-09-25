---
created: 2026-09-22
updated: 2026-09-22
---

# Later conversation selection

Both Later commands resolve one record per conversation before selecting,
sorting, rendering, opening, or capturing. The day command resolves only the
items in its day. Counts and ambiguity checks describe that fetched scope,
not every conversation in the workspace.

`#name` restricts matches to channels; `@name` restricts them to one-to-one
DMs. Bare names search all conversation types. Only `*` is a wildcard;
punctuation is literal, and exact ambiguous names fail with conversation IDs
for disambiguation. Rerun hints preserve and shell-quote the type prefix.

Comma-separated names describe the entire set of other group participants,
in any order. Each name or pattern must match a distinct participant, using
their full name, display name, or handle. A larger group cannot match a
subset query. User IDs preserve identity and unresolved participants remain
in the set; missing profile data must never shrink a group.

Live membership and the session user's ID are required for exact participant
matching. Creation-time `mpdm-` slugs can be stale, so their resolved handles
are only a display fallback. Explicit conversation IDs and raw slugs remain
available when membership cannot be verified. Failed membership pagination
discards the partial result. A C/G-prefixed ID does not prove a conversation
is a channel: Slack Connect DMs can use those prefixes. An unresolved type
must never enter a `#` selection.
