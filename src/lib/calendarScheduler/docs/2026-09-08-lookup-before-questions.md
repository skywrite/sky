---
created: 2026-09-08
updated: 2026-09-08
---

# Look up the meeting before asking questions

Voice could call the calendar tools, but still treated a scheduling request as a
form to complete in conversation. Asking for a day or email before calling the
tool bypassed the behavior already shipped in the `/clock` composer: Cerebras
interprets the words, an omitted date means today, and the live notebook contact
index supplies scored matches and stored email addresses.

The command descriptions and voice/chat prompts now explicitly call preparation
first, preserving names and initials as spoken. The parser excludes the speaker's
"me" and "myself" from guest lookup; their connected calendar account covers the
organizer. It leaves contact questions to the actual lookup and uses the existing
today, local timezone and 30-minute defaults. The voice asks only questions the
result still leaves unresolved and obtains a pending approval before asking for
one spoken yes.

The contact search also used aliases for ranking but stripped them before
resolving the guest. Results now carry those aliases and the shared interaction
score. A unique stored alias or strong direct name prefix can identify a person
despite weak fuzzy matches. Scores order equal-quality namesakes rather than
choosing between them. An identified person retains their ID while their saved
email choices are offered, including in the terminal and composer.

Regression tests cover exact aliases, direct prefixes, weak email-domain matches,
namesakes, saved email choices, the civil-clock parser and desktop/mobile composer
selection. A separate synthetic check uses the configured Realtime voice model
and the real Cerebras parser, with fake contacts and calendar writes disabled, to
verify lookup occurs before any clarification. The fixture clock is shortly after
midnight with the previous notebook day still open.

The live synthetic run called preparation immediately, resolved initials to the
stored contact and its one saved address, kept today's 01:00 and the 30-minute
default, then opened the pending approval before asking to send. A second run
offered the matched contact's two saved addresses; "use the work address" carried
the exact chosen email into another preparation and reached one send confirmation.
Neither run issued a confirmation tool call or created a real event.
