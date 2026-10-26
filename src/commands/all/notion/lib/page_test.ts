import { assert, test } from '#test'
import { notionLink } from './page.ts'

test('notion page - a read reports a link the person can open', () => {
  assert({
    given: 'a pasted link, a dashed page id, a bare id, and a data source reference',
    should: 'keep the link, turn page ids into Notion links, and give nothing for the reference',
    actual: [
      notionLink('https://app.notion.com/p/0123456789abcdef0123456789abcdef'),
      notionLink('01234567-89ab-cdef-0123-456789ABCDEF'),
      notionLink(' 0123456789abcdef0123456789abcdef '),
      notionLink('collection://0123456789abcdef'),
    ],
    expected: [
      'https://app.notion.com/p/0123456789abcdef0123456789abcdef',
      'https://www.notion.so/0123456789abcdef0123456789abcdef',
      'https://www.notion.so/0123456789abcdef0123456789abcdef',
      undefined,
    ],
  })
})
