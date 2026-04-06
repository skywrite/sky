import { assert, test } from '#test'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'

test(`${ItemList.name}.toSorted(): return sorted list`, () => {
  const given = 'adding an item out of order'
  const should = 'return a list in order'

  let dic1 = new ItemList({ title: 'Professional Complete' })
  dic1 = dic1.add('15:00 > Inbox zero')
  dic1 = dic1.add('16:00 > acme/bob Slack -> make super app')
  dic1 = dic1.add('15:30 > acme/nick Slack -> make super app')

  let dic2 = new ItemList({ title: 'Professional Complete' })
  dic2 = dic2.add('15:00 > Inbox zero')
  dic2 = dic2.add('15:30 > acme/nick Slack -> make super app')
  dic2 = dic2.add('16:00 > acme/bob Slack -> make super app')

  assert({ given, should, expected: dic2.toMarkdown(), actual: dic1.toSorted().toMarkdown() })
})

/*

NOTE:

On sorting, you really only want to use this for the todos.

Any commitments with times, that might be confusing as the time should take precedence over the item's status.

*/

test(`${ItemList.name}.toSorted(): return sorted list with predicate`, () => {
  const given = 'a list with some completed items'
  const should = 'return a list in order'

  const dic1 = new ItemList({
    title: 'Professional Todos',
    items: ['tweet', '~~empty whiteboard~~', 'read book'],
  })

  const dic2 = new ItemList({
    title: 'Professional Todos',
    items: ['~~empty whiteboard~~', 'tweet', 'read book'],
  })

  const sortingPredicate = (a: string, b: string) => {
    const aDone = DayDocument.isItemDone(a) && DayDocument.itemDoesNotStartWithTime(a)
    const bDone = DayDocument.isItemDone(b) && DayDocument.itemDoesNotStartWithTime(b)

    if (aDone && bDone) return 0
    if (aDone && !bDone) return -1
    if (!aDone && bDone) return 1

    return 0
  }

  assert({ given, should, expected: dic2.toMarkdown(), actual: dic1.toSorted(sortingPredicate).toMarkdown() })
})
