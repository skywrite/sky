import { assert, test } from '#test'
import { excludeParties, partyExclusionSet, partyNames } from './parties.ts'
import type { EntityIndex } from './resolve.ts'
import { candidatesFromPaths } from './resolve.ts'

const index: EntityIndex = {
  candidates: candidatesFromPaths([
    'people/Jane-Doe.md',
    'people/Sam.md',
    'people/Alice-Smith.md',
    'orgs/Acme-Corp.md',
    'projects/open/Atlas-Rollout/notes.md',
  ]),
  canResolve: () => true,
}

test('partyNames splits comma lists and skips channels and blanks', () => {
  assert({
    given: 'frontmatter values with a comma list, a channel, and empty slots',
    should: 'return the individual names only',
    actual: partyNames(['Jane Doe, Sam Poe', '#eng-updates', undefined, null, '  ']),
    expected: ['Jane Doe', 'Sam Poe'],
  })
})

test('excludeParties drops exact party matches and keeps order', () => {
  assert({
    given: 'refs containing a party under different casing',
    should: 'drop the party, keep the rest verbatim',
    actual: excludeParties(['projects/Atlas-Rollout', 'Jane Doe', 'Acme Corp'], new Set(['jane doe'])),
    expected: ['projects/Atlas-Rollout', 'Acme Corp'],
  })
  assert({
    given: 'no parties',
    should: 'change nothing',
    actual: excludeParties(['Jane Doe'], new Set()),
    expected: ['Jane Doe'],
  })
})

test('partyExclusionSet without an index normalizes the written names', () => {
  assert({
    given: 'a comma-joined who list',
    should: 'exclude each name as written',
    actual: [...partyExclusionSet(['Jane Doe, Bob'])].sort(),
    expected: ['bob', 'jane doe'],
  })
})

test('partyExclusionSet resolves a first-name party to its person file', () => {
  const parties = partyExclusionSet(['Jane'], { index })
  assert({
    given: 'a party written by first name only',
    should: 'exclude the canonical person ref too',
    actual: excludeParties(['Jane Doe', 'projects/Atlas-Rollout'], parties),
    expected: ['projects/Atlas-Rollout'],
  })
})

test('partyExclusionSet covers a first-name person file for a full party name', () => {
  const parties = partyExclusionSet(['Sam Poe'], { index })
  assert({
    given: 'a party written in full whose file carries only the first name',
    should: 'exclude the short ref the party tokens can spell',
    actual: excludeParties(['Sam', 'Acme Corp'], parties),
    expected: ['Acme Corp'],
  })
})

test('partyExclusionSet never excludes a person the party tokens cannot spell', () => {
  const parties = partyExclusionSet(['Alice Grant'], { index })
  assert({
    given: 'a party sharing only a first name with a known person',
    should: 'keep that person eligible for rel',
    actual: excludeParties(['Alice Smith'], parties),
    expected: ['Alice Smith'],
  })
})
