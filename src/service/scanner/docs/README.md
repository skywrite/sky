# Scanner

Boot-time and watcher-driven ingestion of the notebook tree into the in-memory
`Store`: entity rosters (people, orgs, projects, places), tags, and the
interaction scoring that ranks people and orgs (`peopleWithScores`,
`organizationsWithScores`).

## Files

- `scan.ts` — `createScanners(store, entityChecker)`: per-file readers that
  update rosters, track tag recency, and record person/org interactions from
  time files (`who`/`rel`/`to`/`from`/`cc`/`bcc` frontmatter).
- `entities.ts` — path-based classification: which entity family a file
  belongs to, and `getInteractionWeight`, which maps an action filename to a
  scoring weight by its medium segment.
- `walkDirs.ts` — directory traversal.

## How an interaction scores

A time file names people in its frontmatter. Its date comes from the day path
(`parseDateFromDayPath`, layout-aware). Its weight comes from the medium token
in the filename — one `_`-separated segment, matched exactly, in any position,
so every generation of the naming convention classifies:

```
09-45_Zoom_Jane-Doe_Sync.md      current  HH-MM_Medium_Who_Title
zoom_Jane-Doe_Sync.md            legacy   Medium_Who_Title
Jane-Doe_In-Person.md            legacy   Who_Medium
```

Weights: meetings 10, email 5, messages (slack, loom, imessage, whatsapp,
signal, `-audio` variants) 3, `day.md` rel mentions 2. Files under `/events/`
count as meetings. `gdoc`, `gslides`, `video`, and `x` are deliberately
unweighted — shared artifacts and posts, not direct interactions.

`ScoringStore` applies recency decay on top; see `../scoring/ScoringStore.ts`.

## One person, many spellings

A file may name a person any way it likes — `Jane Doe`, `jane doe`, the
`Janie` her profile lists under `name:`. Interactions are recorded under the
spelling used and reported as one person: `getPeopleWithScores` adds up the
entries whose names match case-insensitively, and the entries under the other
names that person's file lists (`Store.rememberPersonNames`, fed by
`readFileAndUpdatePeople`; `spellingsOf` answers for a name). A name two
profiles both list — a bare first name — belongs to neither: its interactions
stand under it alone, so the dominance rule that resolves bare names keeps its
footing. Every listed name reports the same total, so a lookup by any spelling
finds the person.

## History

- `2026-08-30-scoring-blind-to-timestamped-filenames.md` — meetings, emails,
  and messages silently stopped scoring when filenames gained the `HH-MM_`
  time prefix; prefix matching replaced with segment-exact matching.
- `2026-09-01-one-score-per-person.md` — a person's score and last interaction
  were split by the spelling and casing each file used; reported as one person
  now, across the names the profile lists.
