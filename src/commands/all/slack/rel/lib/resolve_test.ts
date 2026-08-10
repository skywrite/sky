import { assert, test } from '#test'
import type { EntityIndex } from './resolve.ts'
import { candidatesFromPaths, normalizeEntityName, resolveMention } from './resolve.ts'

test('normalizeEntityName collapses separators and case', () => {
  assert({
    given: 'a hyphenated stem',
    should: 'normalize',
    actual: normalizeEntityName('Jane-Doe'),
    expected: 'jane doe',
  })
  assert({
    given: 'mixed separators',
    should: 'normalize',
    actual: normalizeEntityName('  Acme_Corp Inc '),
    expected: 'acme corp inc',
  })
})

test('candidatesFromPaths derives kinds, statuses, and archived people', () => {
  const candidates = candidatesFromPaths([
    'people/2024/ja/Jane-Doe.md',
    'people-old/John-Smith.md',
    'orgs/fintech/Acme-Corp.md',
    'projects/open/Atlas-Rollout/notes.md',
    'projects/completed/2026/Beacon-Launch/mod.md',
    'projects/_template.md',
  ])
  const byRef = new Map(candidates.map((c) => [c.ref, c]))
  assert({
    given: 'a nested person file',
    should: 'use spaced stem',
    actual: byRef.get('Jane Doe')?.kind,
    expected: 'person',
  })
  assert({
    given: 'a people-old file',
    should: 'mark archived',
    actual: byRef.get('John Smith')?.archivedPerson,
    expected: true,
  })
  assert({ given: 'an org file', should: 'be an org', actual: byRef.get('Acme Corp')?.kind, expected: 'org' })
  assert({
    given: 'an open project dir',
    should: 'carry status',
    actual: byRef.get('projects/Atlas-Rollout')?.projectStatus,
    expected: 'open',
  })
  assert({
    given: 'a year-nested completed project',
    should: 'skip the year level',
    actual: byRef.get('projects/Beacon-Launch')?.projectStatus,
    expected: 'completed',
  })
  assert({
    given: 'a template file',
    should: 'be excluded',
    actual: candidates.some((c) => c.norm.includes('template')),
    expected: false,
  })
})

test('candidatesFromPaths prefers current people over people-old duplicates', () => {
  const candidates = candidatesFromPaths(['people-old/Jane-Doe.md', 'people/2024/ja/Jane-Doe.md'])
  assert({
    given: 'the same person in both dirs',
    should: 'keep one candidate',
    actual: candidates.length,
    expected: 1,
  })
  assert({
    given: 'the same person in both dirs',
    should: 'count as current',
    actual: candidates[0].archivedPerson,
    expected: undefined,
  })
})

function index(): EntityIndex {
  return {
    candidates: candidatesFromPaths([
      'people/2024/ja/Jane-Doe.md',
      'people/2025/mi/Michael-Torres.md',
      'people/2025/mi/Michael-Vance.md',
      'people-old/Janet-Doerr.md',
      'orgs/Acme-Corp.md',
      'projects/open/Atlas-Rollout/notes.md',
      'projects/completed/Beacon-Launch/mod.md',
    ]),
    canResolve: () => true,
  }
}

test('resolveMention: exact and spaced-form matches', () => {
  assert({
    given: 'an exact spaced name',
    should: 'resolve',
    actual: resolveMention('Jane Doe', 'person', { index: index() }),
    expected: 'Jane Doe',
  })
  assert({
    given: 'a hyphenated mention',
    should: 'resolve via normalization',
    actual: resolveMention('jane-doe', 'person', { index: index() }),
    expected: 'Jane Doe',
  })
  assert({
    given: 'a project mention',
    should: 'resolve to the path ref',
    actual: resolveMention('Atlas Rollout', 'project', { index: index() }),
    expected: 'projects/Atlas-Rollout',
  })
})

test('resolveMention: kind scoping', () => {
  assert({
    given: 'a person name asked as org',
    should: 'abstain',
    actual: resolveMention('Jane Doe', 'org', { index: index() }),
    expected: undefined,
  })
})

test('resolveMention: unique first-name resolves, ambiguous abstains', () => {
  assert({
    given: 'a unique first name',
    should: 'resolve',
    actual: resolveMention('Jane', 'person', { index: index() }),
    expected: 'Jane Doe',
  })
  assert({
    given: 'an ambiguous first name without scores',
    should: 'abstain',
    actual: resolveMention('Michael', 'person', { index: index() }),
    expected: undefined,
  })
})

test('resolveMention: scores break ambiguity only when dominant', () => {
  const scores = new Map([
    ['michael torres', 9],
    ['michael vance', 1],
  ])
  assert({
    given: 'a dominant interaction score',
    should: 'resolve to the dominant person',
    actual: resolveMention('Michael', 'person', { index: index(), scores }),
    expected: 'Michael Torres',
  })
  const close = new Map([
    ['michael torres', 3],
    ['michael vance', 2],
  ])
  assert({
    given: 'near-tied scores',
    should: 'abstain',
    actual: resolveMention('Michael', 'person', { index: index(), scores: close }),
    expected: undefined,
  })
})

test('resolveMention: fuzzy catches close variants, archived people need more', () => {
  assert({
    given: 'a light misspelling of a current person',
    should: 'resolve',
    actual: resolveMention('Jane Dooe', 'person', { index: index() }),
    expected: 'Jane Doe',
  })
  assert({
    given: 'a vaguely similar archived person',
    should: 'abstain under the higher bar',
    actual: resolveMention('Janet Dorr', 'person', { index: index() }) === 'Janet Doerr',
    expected: false,
  })
})

test('resolveMention: partial project names resolve via token subset', () => {
  assert({
    given: 'a short project mention',
    should: 'resolve to the unique containing project',
    actual: resolveMention('Atlas', 'project', { index: index() }),
    expected: 'projects/Atlas-Rollout',
  })
  assert({
    given: 'tokens not all present',
    should: 'abstain',
    actual: resolveMention('Atlas Beacon', 'project', { index: index() }),
    expected: undefined,
  })
})

test('resolveMention: project status filter', () => {
  assert({
    given: 'a completed project under open-only resolution',
    should: 'abstain',
    actual: resolveMention('Beacon Launch', 'project', { index: index(), projectStatuses: ['open'] }),
    expected: undefined,
  })
  assert({
    given: 'a completed project with all statuses',
    should: 'resolve',
    actual: resolveMention('Beacon Launch', 'project', { index: index() }),
    expected: 'projects/Beacon-Launch',
  })
})
