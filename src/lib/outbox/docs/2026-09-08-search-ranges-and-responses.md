---
created: 2026-09-08
updated: 2026-09-08
---

# Fixed search ranges and response memory

The day-only scanner did not let the owner repeat a controlled search. Its file
date filter also could not enforce a time boundary or find an in-range message
inside a capture filed on another day. A stronger model alone cannot fix either
gap.

Outbox now saves explicit From/Through minute boundaries in `outbox/search.md`.
The range is interpreted in the wall-clock times shown by saved messages, includes
both endpoint minutes, and remains fixed across days and service restarts. The
UI explains that coverage is saved Slack/email captures. Check progress records
the range actually used, separately from the currently edited controls.

Discovery indexes message headings and falls back to `when:`. A capture without
a timestamp can still enter on its filing date; partial-day uncertainty is made
visible. Related later captures supply resolution evidence for an older selected
request. They do not introduce new requests outside the chosen range. Missing
history, unreadable files, and bounded-context truncation cannot become a
successful empty result.

The old protected-draft branch kept an edited or approved conversation from
being reassessed when it changed, even after a sent report archived it. Reruns
now distinguish an unsent draft, an owner-reported send, and an actual captured
reply. Fable 5.1 high receives that state and the selected range. Source quotes
must exist before an observed answer can archive an existing review. New asks
can reopen a closed conversation without inheriting its previous native draft.
Human edits remain intact while unresolved new context is flagged for review.

Caching includes the chosen range and the review revision. Merely using a
conversation hash would miss an afternoon request already present in the source
when the morning-only search ran. Merely retaining an earlier model explanation
would keep saying Needs review after the owner reported sending it.

Verification covers inclusive boundaries across dates, invalid dates, persistence
across midnight, stale range edits, captures filed on other days, replies after
the selected end, owner reports, fabricated evidence, reopening, and incomplete
context. Live Fable 5.1 high checks used fictional conversations to verify later
resolution, outstanding approval after clarification, and a new request after a
reported send. No real account messages were used in those model checks.
