import * as marked from 'marked'
import { fetchLinksFromTokens } from '#shared/models/Markdown/Link/mod.ts'
import { assert, test } from '#test'

const MARKDOWN = `- Review [the deck][deck] with Jane
- Inbox zero in [mail][]
- Read the [docs](https://example.com/docs)
- Ask [Jane][nowhere] about it

[deck]: https://example.com/atlas-deck
[mail]: https://example.com/mail
`

/** The inline tokens of every list item — what ItemList.fromMarkdownTokens feeds the collector. */
function itemTokens(markdown: string): marked.Token[] {
  const list = marked.lexer(markdown).find((token) => token.type === 'list') as marked.Tokens.List | undefined
  if (!list) throw new Error('Expected a list')
  return list.items.flatMap((item) => item.tokens)
}

test('fetchLinksFromTokens - files reference links under their label', () => {
  const links = fetchLinksFromTokens(itemTokens(MARKDOWN))

  assert({
    given: 'a [text][label] link and a [label][] link',
    should: 'key both by the label that the definition line uses',
    actual: [...links.keys()].sort(),
    expected: ['deck', 'mail'],
  })
  assert({
    given: 'the [text][label] link',
    should: 'carry the label and the resolved href, not the link text',
    actual: links.get('deck'),
    expected: { label: 'deck', href: 'https://example.com/atlas-deck' },
  })
  assert({
    given: 'an inline link and a reference with no definition',
    should: 'add no entry for either',
    actual: [links.has('docs'), links.has('nowhere'), links.has('Jane')],
    expected: [false, false, false],
  })
})
