import { assert, test } from '#test'
import { splitLinks, webLinkOf } from './links.ts'

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

test({ name: 'links - a saved link that is a web address opens that address under its title' }, () => {
  assert({
    given: 'a titled Markdown link whose title has brackets and an apostrophe of its own',
    should: 'give the address and the title as words',
    actual: webLinkOf(
      "[Atlas plan - Jane's notes (Google Docs)](https://docs.example.com/document/d/abc_DEF-123/edit?x=1)",
    ),
    expected: {
      href: 'https://docs.example.com/document/d/abc_DEF-123/edit?x=1',
      title: "Atlas plan - Jane's notes (Google Docs)",
    },
  })
  assert({
    given: 'an address saved without a title',
    should: 'name it by where it goes',
    actual: webLinkOf('https://www.example.com/wiki/Thing_(band)/'),
    expected: { href: 'https://www.example.com/wiki/Thing_(band)/', title: 'example.com/wiki/Thing_(band)' },
  })
})

test({ name: 'links - a saved link that is not a web address stays as it was saved' }, () => {
  assert({
    given: 'a name, a link to a notebook file, a script address, and an address inside a sentence',
    should: 'treat none of them as a web link',
    actual: [
      'Jane Doe',
      '[Atlas](projects/open/Atlas/README.md)',
      '[Atlas](javascript:alert(1))',
      'See [Atlas](https://example.com/atlas) for the plan',
    ].map(webLinkOf),
    expected: [null, null, null, null],
  })
})
