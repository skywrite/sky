import { assert, test } from '#test'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'

test(`${ItemList.name}.equals(): DayItem arrays`, () => {
  const dic1 = ItemList.fromArray('Professional Complete', [
    '15:00 > Inbox zero',
    '16:00 > acme/bob Slack -> make super app',
  ])

  const dic2 = ItemList.fromArray('Professional Complete', [
    '15:00 > Inbox zero',
    '16:00 > acme/bob Slack -> make super app',
  ])

  const dic3 = ItemList.fromArray('Professional Complete', ['16:00 > acme/bob Slack -> make super app'])

  const dic4 = ItemList.fromArray('Google Complete', ['15:00 > Inbox zero', '16:00 > acme/bob Slack -> make super app'])

  const dic5 = ItemList.fromArray('Professional Complete', [
    '15:00 > Inbox zero',
    '16:00 > acme/sally Slack -> make super app',
  ])

  assert({ expected: true, actual: dic1.equals(dic2) })
  assert({ expected: true, actual: dic2.equals(dic1) })

  assert({ expected: false, actual: dic1.equals(dic3) })
  assert({ expected: false, actual: dic1.equals(dic4) })
  assert({ expected: false, actual: dic2.equals(dic5) })
})
