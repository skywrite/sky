---
created: 2026-09-07
updated: 2026-09-07
---

# Familiarity needs contact

## Problem

Calendar attendees should use the names the notebook owner calls people,
while retaining enough context to recognize an unfamiliar guest. The shared
person score previously counted every frontmatter reference equally. A
person discussed in many meetings could outrank a child whose interactions
rarely get logged. A threshold on that total could turn an unfamiliar
`Taylor Quinn` into an unexplained `Taylor`.

`met: Never` cannot safely settle familiarity: an old profile may disagree
with later experience. Absence of a date is also absence of data, rather
than evidence of a distant relationship.

## Decision

Keep scoring mathematical and inspectable. Direct participation retains the
existing medium weights and recency tiers. References only in `rel` earn
one tenth of those points for relevance and nothing for familiarity.

Add 100 permanent points for the explicit `Person/Family` hierarchy,
including descendants such as `Person/Family/Spouse`. Other tag spellings
do not imply membership. Apply the bonus once to the combined person so
several aliases or family tags cannot compound it. A dated introduction
likewise counts once; missing or stale met metadata imposes no penalty.

The common relevance score continues to rank people throughout the app.
The new familiarity total gates short calendar names at 100 points. This
keeps frequent mentions useful for retrieval without allowing mentions
alone to establish familiarity. The threshold and weights are explicit
policy choices, not learned estimates of relationship strength.

## Verification

Coverage follows both totals through recency, aliases, source removal,
profile edits, and store replacement. It checks exact family tag boundaries,
directory order during scans, and one contribution per person and file.
Schedule tests combine real scanning with email resolution: family and
direct contact permit short names, heavy mention activity does not, and
changed scores take effect on the next route response.
