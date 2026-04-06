import { assert, test } from '#test'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'

test(`${ItemList.name}.add(): single item`, () => {
  let dic1 = new ItemList('Professional Complete')
  dic1 = dic1.add('15:00 > Inbox zero')
  dic1 = dic1.add('16:00 > acme/bob Slack -> make super app')

  let dic2 = new ItemList('Professional Complete')
  dic2 = dic2.add('15:00 > Inbox zero')
  dic2 = dic2.add('16:00 > acme/bob Slack -> make super app')

  assert({ expected: true, actual: dic1.equals(dic2) })
})

/*
test(`${ItemList.name}.add(): single item sorted`, () => {
  const given = 'adding an item out of order'
  const should = 'return a list in order'

  let dic1 = new ItemList({ title: 'Professional Complete', sorted: true })
  dic1 = dic1.add('15:00 > Inbox zero')
  dic1 = dic1.add('16:00 > acme/bob Slack -> make super app')
  dic1 = dic1.add('15:30 > acme/nick Slack -> make super app')

  let dic2 = new ItemList({ title: 'Professional Complete', sorted: true })
  dic2 = dic2.add('15:00 > Inbox zero')
  dic2 = dic2.add('15:30 > acme/nick Slack -> make super app')
  dic2 = dic2.add('16:00 > acme/bob Slack -> make super app')

  assert({ given, should, expected: dic1.toMarkdown(), actual: dic2.toMarkdown() })
})
*/
