---
created: 2026-09-07
updated: 2026-09-07
---

# Readable workstream identities that survive retries

UUIDs and request hashes kept workstream references stable, but gave people no
useful context when browsing notebook folders or following a workstream URL.
New IDs combine local creation time through seconds with up to six words from
the title, preserving capitalization. For example:
`2025-03-15_13-30-42_Launch-the-Atlas-Pilot`.

The title can change without renaming the identity. Short titles do not acquire
filler words; punctuation is normalized, accents are transliterated, and long
slugs fit the existing identity length limit. An atomic allocation checks existing
records, deleted records, and occupied folders before adding a numeric suffix.
Existing explicit identities remain valid.

A readable name cannot also serve as a creation request's retry identity: the
time or wording can change between attempts. Capture, promotion, and accepted
sub-workstream proposals therefore persist a separate, immutable
`creationOperationId`. Retries find the originally accepted work, including after
a folder move or service restart. A deleted record rejects the retry instead of
creating another copy. Capture replay also avoids repeating Sky setup or changing
authority that the person has since edited.

Record timestamps retain their existing UTC representation. Creation names use
the local system timezone and the exact clock through the shared date library,
so seconds are real and the date does not shift at UTC midnight.
