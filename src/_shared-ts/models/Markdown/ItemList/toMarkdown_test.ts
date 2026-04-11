import { assert, test } from '#test'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'

test(`${ItemList.name}.toMarkdown()`, () => {
  const dicEmpty = new ItemList('Professional Complete')

  const expected = ['## Professional Complete', '-'].join('\n')

  assert({
    given: 'empty collection',
    should: 'return blank item',
    actual: dicEmpty.toMarkdown(),
    expected,
  })
})

test(`${ItemList.name}.toMarkdown()`, () => {
  let dic = new ItemList('Professional Complete')
  dic = dic.add(['15:00 > Inbox zero', '16:00 > acme/bob Slack -> make super app'])

  const expected = [
    '## Professional Complete',
    '- 15:00 > Inbox zero',
    '- 16:00 > acme/bob Slack -> make super app',
  ].join('\n')

  assert({
    given: 'collection w/ 2 items',
    should: 'return markdown with items',
    actual: dic.toMarkdown(),
    expected,
  })
})
