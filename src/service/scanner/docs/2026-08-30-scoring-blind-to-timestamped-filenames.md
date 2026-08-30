# Scoring was blind to timestamped filenames

2026-08-30

## Symptom

A transcript run resolved a bare first name to the wrong namesake. The right
person — met the day before, meeting file on disk — was missing from the
known-contacts roster the model matches against, so the model confidently
expanded the bare name to the only namesake it could see, and the person
distiller (which trusts confirmed full names) wrote to the wrong profile.

## Root cause

`getInteractionWeight` classified action files by filename *prefix*:
`zoom_…`, `in-person_…`, `slack_…`, `email_…`. The naming convention had
long since moved the medium to the second segment — `09-45_Zoom_…` — so the
prefix never matched, the weight came back 0, and `trackPersonInteractions`
skipped the file. Meetings, emails, and messages under the current convention
never scored at all.

Two consumers compounded the damage:

- `peopleWithScores` froze each person's `lastInteraction` at their last
  old-convention file (or their `met:` date). Active people read as years
  stale.
- The transcript pipeline's known-contacts roster windows on
  `lastInteraction` (12 months). Stale-reading people fell out of the
  window entirely — invisible to name matching, which is what mis-resolved
  the namesake: with one candidate hidden, the other looked unambiguous.

The week-directory layout migration was ruled out: `parseDateFromDayPath`
handles the new paths correctly. Only the weight classification was broken.

## Fix

Match the medium as a `_`-separated filename segment, exactly, in any
position. All three naming generations classify; a medium word inside a
hyphenated title segment (`…_Zoom-Strategy-Discussion.md`) still doesn't.
Message media the old prefixes never covered (imessage, whatsapp, signal,
their `-audio` variants) now score at the message weight. `gdoc`, `gslides`,
`video`, and `x` stay unweighted on purpose.

Scores are rebuilt from the tree on every boot, so the correction applies
notebook-wide on the next service restart — no data migration.

## Lesson

The scanner had no tests pinning filename→weight behavior, so a naming
convention change silently zeroed the strongest scoring signal for a long
time. `entities_test.ts` now pins every convention generation and the
deliberate exclusions.
