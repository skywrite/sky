import { assert, test } from '#test'
import { splitLinks } from './links.ts'

test({ name: 'links - an address in a sentence becomes a run of its own, punctuation left to the sentence' }, () => {
  assert({
    given: 'a sentence with an address followed by a full stop, and one in brackets',
    should: 'split into text and address runs, the stop and the bracket staying text',
    actual: splitLinks('See https://example.com/doc?x=1#top. Also (https://example.com/two), thanks'),
    expected: [
      { text: 'See ' },
      { text: 'https://example.com/doc?x=1#top', url: 'https://example.com/doc?x=1#top' },
      { text: '. Also (' },
      { text: 'https://example.com/two', url: 'https://example.com/two' },
      { text: '), thanks' },
    ],
  })
})

test({ name: 'links - text without an address is one run' }, () => {
  assert({
    given: 'plain words',
    should: 'come back as a single text run',
    actual: splitLinks('no address here'),
    expected: [{ text: 'no address here' }],
  })
})

test({ name: 'links - an address with brackets of its own keeps its closing bracket' }, () => {
  assert({
    given: 'a wiki-style address ending in a bracket that opened inside it',
    should: 'keep the bracket as part of the address',
    actual: splitLinks('https://example.com/wiki/Thing_(band)'),
    expected: [{ text: 'https://example.com/wiki/Thing_(band)', url: 'https://example.com/wiki/Thing_(band)' }],
  })
})
