import { assert, test } from '#test'
import { splitSources, withSources } from './sources.ts'

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
