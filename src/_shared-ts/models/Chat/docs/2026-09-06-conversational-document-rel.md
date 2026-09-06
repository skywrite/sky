---
created: 2026-09-06
updated: 2026-09-06
---

# Conversational references become document relationships

A chat could discuss an earlier meeting while its saved `rel` named only
the project or person involved. The entity suggestion index deliberately
excludes `time/`, and an existing `rel` prevents further entity suggestions
on resume. Neither mechanism could preserve the relationship to the meeting
itself. External artifacts already had an additive save path.

Document references now have a separate save-time resolver shared by the
terminal and web hosts. It extracts references from both speakers and requires
an exact supporting quote in a numbered message. The reference may be
conversational: "my meeting with Jane" qualifies when the notebook identifies
the record. Names and topics alone do not. Context-log paths help find the
record, but loading a file does not create a relationship.

Extraction reads the conversation in overlapping windows so references in
long replies or the middle of a chat survive the smaller taxonomy classifier's
budget. Message timestamps accompany the text: "Friday" belongs to the turn
that said it, even if the chat is saved or resumed weeks later. Search uses
the notebook service's involvement, body, and path filters. Candidates are
read and judged using their metadata and excerpts. A literal cited path can
be verified directly; model-invented paths are rejected.

The matching pass lists every still-plausible candidate. Exactly one verified
match becomes a time ref; several plausible records or a capped search
abstain. This matters because a single result in a truncated list does not
establish uniqueness. Lookup failures are logged and leave the save usable.

The shared save appends the resulting refs alongside existing relationships
and external artifacts. It preserves hand-written spellings and deduplicates
full refs, short refs, paths, and titled links by time identity. A resumed
chat excludes its own file; a branch supplies its own turns as evidence while
retaining its parent's context paths as lookup hints. Disabling auto-rel,
including a branch's preliminary parent checkpoint, skips the lookup.

Verified with synthetic fixtures: an informal meeting reference without a date
or filename, ambiguity, unrelated background files, fabricated references,
old folder layouts, missing records, self references, capped searches, long
conversations, and additive saves and resumes. No notebook content is used
in these fixtures.

A check through the configured models exposed a false positive when extraction
could see the context paths: a general Atlas strategy question became a
reference to an Atlas meeting. Detection now sees the conversation alone;
candidate paths enter only after a quoted reference has been found. Matching
also checks that the quote really refers to a record. Generic extracted terms
such as "meeting" and "Friday" are filtered before lookup so they cannot flood
an otherwise specific name search. The model check then passed four synthetic
cases: an informal reference without a date, a Friday reference, two
indistinguishable meetings, and a general topic with a meeting in context.
