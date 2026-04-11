import { assert, test } from '#test'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'

test(`${ItemList.name}.fromArray(): string arrays`, () => {
  const dic = ItemList.fromArray('Professional Complete', [
    '15:00 > Inbox zero',
    '16:00 > acme/bob Slack -> make super app',
  ])

  assert({ expected: 'Professional Complete', actual: dic.title })

  assert({
    expected: ['15:00 > Inbox zero', '16:00 > acme/bob Slack -> make super app'],
    actual: Array.from(dic).map(String),
  })
})
