import { assert, test } from '#test'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'

test(`${ItemList.name}._addItems()`, () => {
  let dic1 = new ItemList('Professional Complete')
  dic1 = dic1['_addItems'](['15:00 > Inbox zero', '16:00 > acme/bob Slack -> make super app'])

  let dic2 = new ItemList('Professional Complete')
  dic2 = dic2['_addItems'](['15:00 > Inbox zero', '16:00 > acme/bob Slack -> make super app'])

  assert({ expected: true, actual: dic1.equals(dic2) })
})

/*
test(`${ItemList.name}._addItems()`, () => {
  const given = 'adding an item out of order'
  const should = 'return a list in order'

  let dic1 = new ItemList({ title: 'Professional Complete', sorted: true })
  dic1 = dic1['_addItems']([
    '15:00 > Inbox zero',
    '16:00 > acme/bob Slack -> make super app',
    '15:30 > acme/nick Slack -> make super app',
  ])

  let dic2 = new ItemList({ title: 'Professional Complete', sorted: true })
  dic2 = dic2['_addItems']([
    '15:00 > Inbox zero',
    '15:30 > acme/nick Slack -> make super app',
    '16:00 > acme/bob Slack -> make super app',
  ])

  assert({ given, should, expected: true, actual: dic1.equals(dic2) })
})
*/
