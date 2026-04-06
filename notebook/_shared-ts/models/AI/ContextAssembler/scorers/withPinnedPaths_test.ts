import { assert, test } from '#test'
import { type CollectionEntityType, type CollectionItem, Document } from '#shared/models/Markdown/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createRecencyTypeScorer } from './recencyTypeScorer.ts'
import { withPinnedPaths } from './withPinnedPaths.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(body: string): Document {
  return Document.fromMarkdown(`---\n---\n${body}`)
}

function makeItem(
  overrides: Partial<CollectionItem<Document>> & { path: string; type: CollectionEntityType },
): CollectionItem<Document> {
  return { doc: makeDoc('content'), depth: 0, ...overrides }
}

const TODAY = new PlainDate(2026, 2, 23)

// ---------------------------------------------------------------------------
// withPinnedPaths — pinned paths get Infinity, others delegate to inner scorer
// ---------------------------------------------------------------------------

test('withPinnedPaths — pinned path returns Infinity', () => {
  const inner = createRecencyTypeScorer(TODAY)
  const scorer = withPinnedPaths(inner, new Set(['/goals/fitness.md']))

  assert({
    given: 'a path in the pinned set',
    should: 'return Infinity',
    actual: scorer(makeItem({ path: '/goals/fitness.md', type: 'goal' })),
    expected: Infinity,
  })
})

test('withPinnedPaths — non-pinned path delegates to inner scorer', () => {
  const inner = createRecencyTypeScorer(TODAY)
  const scorer = withPinnedPaths(inner, new Set(['/goals/fitness.md']))

  assert({
    given: 'a path NOT in the pinned set',
    should: 'return the inner scorer result',
    actual: scorer(makeItem({ path: '/people/Alice.md', type: 'person' })),
    expected: 6,
  })
})

test('withPinnedPaths — empty set returns the original scorer', () => {
  const inner = createRecencyTypeScorer(TODAY)
  const scorer = withPinnedPaths(inner, new Set())

  assert({
    given: 'an empty pinned set',
    should: 'return the exact same scorer function',
    actual: scorer === inner,
    expected: true,
  })
})
