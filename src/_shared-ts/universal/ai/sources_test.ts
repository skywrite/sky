import { assert, test } from '#test'
import { sourceReference, splitSources, withSources } from './sources.ts'

test('sources - the trailing Sources list comes out of a saved reply, and a reply without one stays whole', () => {
  const saved =
    'Two things are due Friday.\n\nThe rest can wait.\n\nSources:\n- https://example.com/a\n- https://example.com/b/c'
  const plain = 'Two things are due Friday.\n\nSources: none that I know of.'
  assert({
    given: 'a reply with a trailing sources list and one that only mentions the word',
    should: 'split the list off the first and leave the second as it is',
    actual: [splitSources(saved), splitSources(plain)],
    expected: [
      {
        body: 'Two things are due Friday.\n\nThe rest can wait.',
        sources: ['https://example.com/a', 'https://example.com/b/c'],
      },
      { body: plain, sources: [] },
    ],
  })
})

test('sources - annotated notebook and web citations fold together in live and saved replies', () => {
  const file = 'time/2030/W14/04-01/notes/Atlas outline.md'
  const notebook = `\`${file}\` (Jane Doe, April 1).`
  const address = 'https://example.com/review'
  const article = `[Atlas review](${address}) (background).`
  const other = 'https://example.com/next'
  const body = 'The Atlas outline is ready.'
  for (const heading of ['Sources', '#### Sources', '**Sources:**', '**Sources**:', '## Sources:']) {
    const reply = [body, '', heading, '', `* ${notebook}`, '', `* ${article}`, ''].join('\r\n')
    const expected = { body, sources: [notebook, article, other] }
    assert({
      given: `a ${heading} section followed by a separately reported search result`,
      should: 'keep the same annotations, order, and source count on completion and reload',
      actual: [splitSources(reply, [address, other]), splitSources(withSources(reply, [address, other]))],
      expected: [expected, expected],
    })
    assert({
      given: 'an existing annotated transcript used to identify a reply thread',
      should: 'preserve its original text for storage and history hashes',
      actual: withSources(reply, []),
      expected: reply,
    })
  }
  assert({
    given: 'citations with notes following a code span or Markdown link',
    should: 'separate the link destination from its label and annotation',
    actual: [sourceReference(notebook), sourceReference(article)],
    expected: [
      { target: file, note: ' (Jane Doe, April 1).' },
      { target: address, label: 'Atlas review', note: ' (background).' },
    ],
  })
})

test('sources - examples and nonterminal sections stay in the reply', () => {
  const section = '### Sources\n\n- https://example.com/atlas'
  for (const body of [
    `Example:\n\n\`\`\`markdown\n${section}\n\`\`\``,
    `Example:\n\n\`\`\`markdown\n${section}`,
    section
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
    `${section}\n\nThe decision is still pending.`,
    'Sources of uncertainty\n\n- Timing\n- Cost',
  ]) {
    assert({
      given: 'a source example, quoted material, or another section in the answer',
      should: 'preserve the complete reply body',
      actual: splitSources(body),
      expected: { body, sources: [] },
    })
  }
})

test('sources - a reply that named its own sources and had the searched pages appended folds to one list', () => {
  const twice =
    'The rate moved.\n\nSources:\n- https://example.com/a\n- https://example.com/b\n\nSources:\n- https://example.com/b\n- https://example.com/c'
  assert({
    given: 'a reply ending in two Sources lists that share an address',
    should: "give the text without either, and every address once, the reply's own first",
    actual: splitSources(twice),
    expected: {
      body: 'The rate moved.',
      sources: ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
    },
  })
})

test('sources - appending the searched pages to a reply that named its own writes one list', () => {
  const own = 'The rate moved.\n\nSources:\n- https://example.com/a'
  assert({
    given:
      'a reply with its own list and the pages the searches read, one already named; and a plain reply with nothing found',
    should: 'end in one list with each address once, and leave the plain reply as it is',
    actual: [withSources(own, ['https://example.com/a', 'https://example.com/b']), withSources('Nothing read.', [])],
    expected: ['The rate moved.\n\nSources:\n- https://example.com/a\n- https://example.com/b', 'Nothing read.'],
  })
})
