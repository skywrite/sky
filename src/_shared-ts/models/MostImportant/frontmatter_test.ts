import { parseWithError } from '#shared/yaml/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { miFrontmatter, toSingleLine } from './frontmatter.ts'
import MostImportant from './mod.ts'

/** Extract and parse the YAML between the `---` fences. */
function parseFrontmatter(text: string): { data: Record<string, unknown>; error?: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  if (!match) throw new Error('no frontmatter fences found')
  return parseWithError(match[1]) as { data: Record<string, unknown>; error?: string }
}

test('miFrontmatter - plain summary round-trips with bare empty keys', () => {
  const fm = miFrontmatter('Ship pricing page to production')
  const { data, error } = parseFrontmatter(fm)

  assert({
    given: 'a plain summary',
    should: 'parse without error',
    actual: error ?? null,
    expected: null,
  })

  assert({
    given: 'a plain summary',
    should: 'round-trip exactly',
    actual: data.summary,
    expected: 'Ship pricing page to production',
  })

  assert({
    given: 'the empty keys',
    should: 'render bare (corpus format)',
    actual: fm.includes('\ncomplete:\ndateStarted:\nrel:\ntags:\n'),
    expected: true,
  })
})

test('miFrontmatter - colon in summary survives (the "Decide: …" MI shape)', () => {
  const summary = 'Decide: accept or counter the Atlas term sheet'
  const { data, error } = parseFrontmatter(miFrontmatter(summary))

  assert({
    given: 'a summary containing a colon',
    should: 'parse without error',
    actual: error ?? null,
    expected: null,
  })

  assert({
    given: 'a summary containing a colon',
    should: 'round-trip exactly',
    actual: data.summary,
    expected: summary,
  })
})

test('miFrontmatter - quotes and hash survive', () => {
  const summary = 'Ship "v2" pricing #launch today'
  const { data, error } = parseFrontmatter(miFrontmatter(summary))

  assert({
    given: 'a summary with quotes and a hash',
    should: 'parse without error',
    actual: error ?? null,
    expected: null,
  })

  assert({
    given: 'a summary with quotes and a hash',
    should: 'round-trip exactly',
    actual: data.summary,
    expected: summary,
  })
})

test('miFrontmatter - multiline summary stays valid YAML', () => {
  const summary = 'Ship pricing page\nClarification: by 3pm'
  const { data, error } = parseFrontmatter(miFrontmatter(summary))

  assert({
    given: 'a multiline summary',
    should: 'parse without error',
    actual: error ?? null,
    expected: null,
  })

  assert({
    given: 'a multiline summary',
    should: 'round-trip exactly (no junk keys)',
    actual: data.summary,
    expected: summary,
  })

  assert({
    given: 'a multiline summary',
    should: 'not leak a Clarification key into the frontmatter',
    actual: 'Clarification' in data,
    expected: false,
  })
})

test('miFrontmatter - empty summary renders as a bare key parsing to null', () => {
  const fm = miFrontmatter('')
  const { data, error } = parseFrontmatter(fm)

  assert({
    given: 'an empty summary',
    should: 'parse without error',
    actual: error ?? null,
    expected: null,
  })

  assert({
    given: 'an empty summary',
    should: 'parse to null like the other empty keys',
    actual: data.summary,
    expected: null,
  })
})

test('toSingleLine - collapses newlines and whitespace runs', () => {
  assert({
    given: 'a multi-line clarification blob',
    should: 'collapse to one trimmed line',
    actual: toSingleLine('  Ship pricing page\n\nClarification: by 3pm\t today '),
    expected: 'Ship pricing page Clarification: by 3pm today',
  })
})

test('template - colon summary survives the full document round-trip', () => {
  const mi = MostImportant.create(new PlainDate(2025, 10, 1), {
    summary: 'Decide: hire or contract the designer',
    count: 1,
  })
  const { data, error } = parseFrontmatter(mi.toMarkdown())

  assert({
    given: 'a templated MI document with a colon summary',
    should: 'parse without error',
    actual: error ?? null,
    expected: null,
  })

  assert({
    given: 'a templated MI document with a colon summary',
    should: 'round-trip the summary exactly',
    actual: data.summary,
    expected: 'Decide: hire or contract the designer',
  })
})
