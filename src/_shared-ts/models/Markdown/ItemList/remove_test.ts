import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import { assert, test } from '#test'

test(`${ItemList.name}.remove(): middle item`, () => {
  const given = 'an ItemCollection that we will remove from'
  const should = 'return modified ItemCollection with item removed'

  let dic1 = new ItemList('Professional Complete')
  dic1 = dic1.add([
    '15:00 > Inbox zero',
    '15:30 > acme/nick Slack -> make super app',
    '16:00 > acme/bob Slack -> make super app',
  ])

  const res = dic1.remove(1)
  dic1 = res.newList

  let dicExpected = new ItemList('Professional Complete')
  dicExpected = dicExpected.add(['15:00 > Inbox zero', '16:00 > acme/bob Slack -> make super app'])

  assert({ given, should, expected: dicExpected.toMarkdown(), actual: dic1.toMarkdown() })
})

test(`${ItemList.name}.remove(): first`, () => {
  const given = 'an ItemCollection that we will remove from'
  const should = 'return modified ItemCollection with item removed'

  let dic1 = new ItemList('Professional Complete')
  dic1 = dic1.add([
    '15:00 > Inbox zero',
    '15:30 > acme/nick Slack -> make super app',
    '16:00 > acme/bob Slack -> make super app',
  ])

  const res = dic1.remove(0)
  dic1 = res.newList

  let dicExpected = new ItemList('Professional Complete')
  dicExpected = dicExpected.add([
    '15:30 > acme/nick Slack -> make super app',
    '16:00 > acme/bob Slack -> make super app',
  ])

  assert({ given, should, expected: dicExpected.toMarkdown(), actual: dic1.toMarkdown() })
})

test(`${ItemList.name}.remove(): last`, () => {
  const given = 'an ItemCollection that we will remove from'
  const should = 'return modified ItemCollection with item removed'

  let dic1 = new ItemList('Professional Complete')
  dic1 = dic1.add([
    '15:00 > Inbox zero',
    '15:30 > acme/nick Slack -> make super app',
    '16:00 > acme/bob Slack -> make super app',
  ])

  const res = dic1.remove(-1)
  dic1 = res.newList

  let dicExpected = new ItemList('Professional Complete')
  dicExpected = dicExpected.add(['15:00 > Inbox zero', '15:30 > acme/nick Slack -> make super app'])

  assert({ given, should, expected: dicExpected.toMarkdown(), actual: dic1.toMarkdown() })
})
