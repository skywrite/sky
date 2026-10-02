---
created: 2026-10-01
updated: 2026-10-01
---

# Namesakes rank by interaction score

Typing a first name listed every namesake in an order no one could explain.
Equally good name matches were ordered by the picker's own measure: how
many records list the person under `rel`. Every other people search in Sky
uses the notebook's interaction score: global search, front matter
completions, meeting invites and the bare-name resolver.

Link counts never decay, and they ignore participation (`who`, `from`,
`to`). A contact from years ago with many old `rel` entries outranked the
namesake met yesterday. The date under each person made it worse. It was
the profile's `updated:` date, which says nothing about the relationship.

The route now receives the scores the completions use. Equally good
people and orgs order by score, then by the latest direct contact.
Projects have no score, so link counts still order them. A person's row
shows "last contact" instead of the profile date.

Rejected:

- Showing the score's `lastInteraction` as the last contact. A `rel`
  mention moves it, and for many people the newest record is a mention.
  `ScoringStore` now tracks `lastContact` from participation alone.
- Ordering the suggestions before typing by score alone. Projects have no
  score, so they disappeared. The owner, present in nearly every meeting,
  came first. Suggestions now take the best person, org and project in
  turn and leave out the owner named in About me.
- Comparing a score with a link count directly. They share no scale.

The score had a second problem: contact older than a year never faded.
See [the scanner note](../../../scanner/docs/2026-10-01-old-contact-keeps-fading.md).

Synthetic coverage: `catalog_test.ts` ranks a dormant, heavily linked
namesake below recent contacts and checks suggestion order and owner
exclusion. `links_test.ts` drives the HTTP route with a scoring store.
