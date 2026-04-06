import { assert, test } from '#test'
import { Document, type MarkdownStore } from '#shared/models/Markdown/mod.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import ContextAssembler, { estimateTokens, type Scorer } from './mod.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal store that resolves nothing — sufficient for depth: 0 */
const NULL_STORE = {
  resolve: () => ({ type: 'unresolved' as const, value: null, raw: '' }),
  resolveAll: () => [],
} as unknown as MarkdownStore

function makeDoc(body: string): Document {
  return Document.fromMarkdown(`---\n---\n${body}`)
}

function makeDomain(items: Array<{ doc: Document; path: string }>): DomainCollection {
  return DomainCollection.fromDocuments(items, NULL_STORE, { depth: 0 })
}

/** Score every item the same (1). Useful for testing budget logic. */
const FLAT_SCORER: Scorer = () => 1

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

const estimateTokensFixtures = [
  { input: 'x'.repeat(400), expected: 100, description: '400 chars = 100 tokens' },
  { input: 'hello', expected: 2, description: '5 chars rounds up to 2' },
  { input: '', expected: 0, description: 'empty string = 0 tokens' },
  { input: 'x', expected: 1, description: '1 char = 1 token' },
]

estimateTokensFixtures.forEach((fixture) => {
  test(`estimateTokens — ${fixture.description}`, () => {
    assert({
      given: fixture.description,
      should: `return ${fixture.expected}`,
      actual: estimateTokens(fixture.input),
      expected: fixture.expected,
    })
  })
})

// ---------------------------------------------------------------------------
// from — under budget
// ---------------------------------------------------------------------------

test('from — under budget: all kept, none pruned', () => {
  const domain = makeDomain([
    { doc: makeDoc('short'), path: '/people/Alice.md' },
    { doc: makeDoc('also short'), path: '/people/Bob.md' },
  ])

  const asm = ContextAssembler.from(domain, { scorer: FLAT_SCORER, maxTokens: 10000 })

  assert({ given: 'large budget', should: 'keep all', actual: asm.size, expected: 2 })
  assert({ given: 'large budget', should: 'prune none', actual: asm.pruned.length, expected: 0 })
  assert({ given: 'large budget', should: 'not be over budget', actual: asm.overBudget, expected: false })
})

// ---------------------------------------------------------------------------
// from — over budget: lowest-scored pruned first
// ---------------------------------------------------------------------------

test('from — over budget: lowest-scored pruned first', () => {
  const highDoc = makeDoc('x'.repeat(40))
  const lowDoc = makeDoc('y'.repeat(40))

  const domain = makeDomain([
    { doc: highDoc, path: '/goals/important.md' },
    { doc: lowDoc, path: '/places/cafe.md' },
  ])

  const scorer: Scorer = (item) => (item.path.includes('goals') ? 10 : 1)

  // Budget enough for only one doc
  const tokensPerDoc = estimateTokens(highDoc.toMarkdown())
  const asm = ContextAssembler.from(domain, { scorer, maxTokens: tokensPerDoc })

  assert({ given: 'tight budget', should: 'keep 1', actual: asm.size, expected: 1 })
  assert({
    given: 'tight budget',
    should: 'keep the higher-scored item',
    actual: asm.kept[0].item.path,
    expected: '/goals/important.md',
  })
  assert({ given: 'tight budget', should: 'prune the lower-scored', actual: asm.pruned.length, expected: 1 })
})

// ---------------------------------------------------------------------------
// from — ties: smaller doc preferred
// ---------------------------------------------------------------------------

test('from — ties: smaller doc preferred when scores equal', () => {
  const bigDoc = makeDoc('x'.repeat(200))
  const smallDoc = makeDoc('y'.repeat(20))

  const domain = makeDomain([
    { doc: bigDoc, path: '/people/Big.md' },
    { doc: smallDoc, path: '/people/Small.md' },
  ])

  const asm = ContextAssembler.from(domain, { scorer: FLAT_SCORER, maxTokens: 10000 })

  assert({
    given: 'two docs with same score',
    should: 'sort smaller doc first',
    actual: asm.kept[0].item.path,
    expected: '/people/Small.md',
  })
})

// ---------------------------------------------------------------------------
// from — empty collection
// ---------------------------------------------------------------------------

test('from — empty collection: size 0, empty markdown', () => {
  const domain = makeDomain([])

  const asm = ContextAssembler.from(domain, { scorer: FLAT_SCORER })

  assert({ given: 'empty collection', should: 'have size 0', actual: asm.size, expected: 0 })
  assert({ given: 'empty collection', should: 'return empty markdown', actual: asm.toMarkdown(), expected: '' })
  assert({ given: 'empty collection', should: 'have 0 totalTokens', actual: asm.totalTokens, expected: 0 })
})

// ---------------------------------------------------------------------------
// from — always keeps at least 1 item
// ---------------------------------------------------------------------------

test('from — always keeps at least 1 item even if over budget', () => {
  const doc = makeDoc('x'.repeat(400))
  const domain = makeDomain([{ doc, path: '/goals/big.md' }])

  // Budget of 1 token — way too small
  const asm = ContextAssembler.from(domain, { scorer: FLAT_SCORER, maxTokens: 1 })

  assert({ given: 'budget smaller than 1 item', should: 'still keep 1', actual: asm.size, expected: 1 })
  assert({ given: 'budget smaller than 1 item', should: 'be over budget', actual: asm.overBudget, expected: true })
})

// ---------------------------------------------------------------------------
// withBudget — tighter prunes more, returns new instance
// ---------------------------------------------------------------------------

test('withBudget — tighter budget prunes more, returns new instance', () => {
  const doc1 = makeDoc('x'.repeat(40))
  const doc2 = makeDoc('y'.repeat(40))

  const domain = makeDomain([
    { doc: doc1, path: '/goals/a.md' },
    { doc: doc2, path: '/goals/b.md' },
  ])

  const wide = ContextAssembler.from(domain, { scorer: FLAT_SCORER, maxTokens: 10000 })
  assert({ given: 'wide budget', should: 'keep both', actual: wide.size, expected: 2 })

  const tokensPerDoc = estimateTokens(doc1.toMarkdown())
  const tight = wide.withBudget(tokensPerDoc)

  assert({ given: 'tight budget', should: 'keep 1', actual: tight.size, expected: 1 })
  assert({ given: 'withBudget', should: 'return new instance', actual: tight !== wide, expected: true })
})

// ---------------------------------------------------------------------------
// withBudget — looser budget keeps more
// ---------------------------------------------------------------------------

test('withBudget — looser budget keeps more', () => {
  const doc1 = makeDoc('x'.repeat(40))
  const doc2 = makeDoc('y'.repeat(40))

  const domain = makeDomain([
    { doc: doc1, path: '/goals/a.md' },
    { doc: doc2, path: '/goals/b.md' },
  ])

  const tokensPerDoc = estimateTokens(doc1.toMarkdown())
  const tight = ContextAssembler.from(domain, { scorer: FLAT_SCORER, maxTokens: tokensPerDoc })
  assert({ given: 'tight budget', should: 'keep 1', actual: tight.size, expected: 1 })

  const loose = tight.withBudget(10000)
  assert({ given: 'loosened budget', should: 'keep both', actual: loose.size, expected: 2 })
})

// ---------------------------------------------------------------------------
// toMarkdown — delegates to Collection
// ---------------------------------------------------------------------------

test('toMarkdown — delegates to Collection, respects opts', () => {
  const domain = makeDomain([{ doc: makeDoc('Hello world'), path: '/people/Alice.md' }])

  const asm = ContextAssembler.from(domain, { scorer: FLAT_SCORER, maxTokens: 10000 })
  const md = asm.toMarkdown({ delimited: false, includePath: false })

  // Should contain the document content without delimiters or path comments
  assert({
    given: 'toMarkdown with delimited:false, includePath:false',
    should: 'contain the document body',
    actual: md.includes('Hello world'),
    expected: true,
  })
  assert({
    given: 'toMarkdown with delimited:false',
    should: 'not contain START FILE marker',
    actual: md.includes('START FILE'),
    expected: false,
  })
})
