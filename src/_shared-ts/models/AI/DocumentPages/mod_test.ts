import { assert, test } from '#test'
import { cleanDocumentText, DOC_MAX_CHARS, FIND_LEAD_CHARS, pageOf, textVersion } from './mod.ts'

test("a document's text for a model drops HTML comments and keeps fenced code", () => {
  const raw =
    '---\ntitle: Atlas\n---\n\nBody line.\n<!-- machine: { "turns": 3 } -->\n```\n<!-- not a comment: code -->\n```\nLast line.\n'
  const text = cleanDocumentText(raw)
  assert({
    given: 'markdown with a machine comment and a fenced block containing comment syntax',
    should: 'remove the comment and leave the fence as written',
    actual: {
      hasMachine: text.includes('machine'),
      hasFence: text.includes('<!-- not a comment: code -->'),
      hasBody: text.includes('Body line.'),
    },
    expected: { hasMachine: false, hasFence: true, hasBody: true },
  })
})

test('pages continue at nextOffset to the end of the text and carry one version', () => {
  const text = 'abcdefghij'.repeat(5000) // 50,000 chars
  const page = (offset?: number) => {
    const result = pageOf('n.md', text, { offset })
    if (!('markdown' in result)) throw new Error('expected a page')
    return result
  }
  const first = page()
  const second = page(first.nextOffset)
  const third = page(second.nextOffset)
  assert({
    given: 'a 50k-character text paged three times',
    should:
      'cover it exactly once with the page cap, end without a next offset, and stamp every page with the same version',
    actual: {
      lengths: [first.markdown.length, second.markdown.length, third.markdown.length],
      joined: first.markdown + second.markdown + third.markdown === text,
      last: third.nextOffset,
      totals: [first.totalChars, third.totalChars],
      sameVersion: first.version === third.version && first.version === textVersion(text),
      changes: textVersion(text) !== textVersion(text + '!'),
    },
    expected: {
      lengths: [DOC_MAX_CHARS, DOC_MAX_CHARS, 2000],
      joined: true,
      last: undefined,
      totals: [50000, 50000],
      sameVersion: true,
      changes: true,
    },
  })
})

test('find opens the page shortly before a case-insensitive hit, and reports a miss', () => {
  const text = `${'x'.repeat(30000)}The Atlas Decision: proceed.${'y'.repeat(100)}`
  const hit = pageOf('n.md', text, { find: 'atlas decision' })
  const miss = pageOf('n.md', text, { find: 'widget', offset: 0 })
  const late = pageOf('n.md', text, { find: 'atlas', offset: 30010 })
  if (!('markdown' in hit)) throw new Error('expected a page')
  assert({
    given: 'a hit deep in the text, a term that is absent, and a search starting after the only hit',
    should: 'start the page one lead before the hit, include the hit, and return found:false for the other two',
    actual: {
      offset: hit.offset,
      includesHit: hit.markdown.includes('The Atlas Decision'),
      miss: 'found' in miss ? miss.found : 'page',
      late: 'found' in late ? late.found : 'page',
    },
    expected: {
      offset: text.toLowerCase().indexOf('atlas decision') - FIND_LEAD_CHARS,
      includesHit: true,
      miss: false,
      late: false,
    },
  })
})
