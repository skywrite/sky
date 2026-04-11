import { assert, test } from '#test'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'

test(`${ItemList.name}.insert(): item in the middle`, () => {
  let dic1 = new ItemList('Professional Complete')
  dic1 = dic1.add('12:00 > Inbox zero')
  dic1 = dic1.add('14:00 > acme/bob Slack -> make super app')
  dic1 = dic1.insert('13:00 > Yuuuge task', 1)

  const actual = dic1.toMarkdown()
  const expected = [
    '## Professional Complete',
    '- 12:00 > Inbox zero',
    '- 13:00 > Yuuuge task',
    '- 14:00 > acme/bob Slack -> make super app',
  ].join('\n')

  assert({ expected, actual })
})

test(`${ItemList.name}.insert(): item at the end`, () => {
  let dic1 = new ItemList({ title: 'Professional Complete' })
  dic1 = dic1.add('12:00 > Inbox zero')
  dic1 = dic1.add('14:00 > acme/bob Slack -> make super app')
  dic1 = dic1.insert('13:00 > Yuuuge task', -1)

  const actual = dic1.toMarkdown()
  const expected = [
    '## Professional Complete',
    '- 12:00 > Inbox zero',
    '- 14:00 > acme/bob Slack -> make super app',
    '- 13:00 > Yuuuge task',
  ].join('\n')

  assert({ expected, actual })
})

/*
test(`${ItemList.name}.insert(): item at the end (does not sort)`, () => {
  let dic1 = new ItemList({ title: 'Professional Complete', sorted: true })
  dic1 = dic1.add('12:00 > Inbox zero')
  dic1 = dic1.add('14:00 > acme/bob Slack -> make super app')
  dic1 = dic1.insert('13:00 > Yuuuge task', -1)

  const actual = dic1.toMarkdown()
  const expected = [
    '## Professional Complete',
    '- 12:00 > Inbox zero',
    '- 14:00 > acme/bob Slack -> make super app',
    '- 13:00 > Yuuuge task',
  ].join('\n')

  assert({ expected, actual })
})
*/
