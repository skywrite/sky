---
created: 2026-09-07
updated: 2026-09-07
---

# Saving a web chat includes logging it to the day

Save & close filed the transcript but did not add an AI Chat entry to
`day.md`. The shared store makes day logging optional, and the web host
never supplied that option. The day's Chats list combines live threads and
saved transcripts, so appearing there did not establish that the day file
recorded the conversation.

The web host now enables day logging in its save defaults, using the
configured default category. The store reads and writes the day under the
same time root as the transcript and builds the link relative to that day,
including when a branch files beside a parent on another day. A logging
failure leaves the transcript saved and is reported on the page; successful
logging is confirmed too.

The existing close-time filing lifecycle remains. Discard does not log,
and resumed chats keep the store's existing no-duplicate rule: their day
logging is skipped. Previously saved chats are not backfilled by this change.

Verification uses the real web save defaults with scripted enrichment and
a temporary notebook. HTTP saves produce a transcript and a working link
in the chosen category, discard preserves the day file, and an unreadable
day produces a logging failure without losing the transcript.
