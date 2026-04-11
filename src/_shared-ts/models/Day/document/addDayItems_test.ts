import { assert, test } from '#test'
import * as path from 'node:path'
import readTextFileSync from '#shared/fs/readTextFileSync.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'markdown', '_fixtures')

const ARRAY_REDUCER = (map: Record<string, string>, fileName: string): Record<string, string> => {
  return Object.assign(map, { [fileName]: readTextFileSync(path.join(DIR_FIXTURES, fileName)) })
}

const FIXTURES = [
  'day-standard-empty-items.md',
  'day-standard-one-item.md',
  'day-standard-two-items.md',
  'day-standard-three-items.md',
  'day-one-collection.md',
].reduce(ARRAY_REDUCER, {})

test(`${DayDocument.name}.addDayItems()`, () => {
  const dayEmptyItems = DayDocument.fromMarkdown(FIXTURES['day-standard-empty-items.md'])
  const dayOneItem = DayDocument.fromMarkdown(FIXTURES['day-standard-one-item.md'])

  assert({
    given: 'has collection',
    should: 'should add',
    expected: dayOneItem.toMarkdown(),
    actual: dayEmptyItems.addItem('Professional Complete', '15:00 > Inbox zero').toMarkdown(),
  })
})

test(`${DayDocument.name}.addDayItems()`, () => {
  const given = 'has no item collections'
  const should = 'add one empty collection'

  const dayOneCollection = DayDocument.fromMarkdown(FIXTURES['day-one-collection.md'])
  const day = new DayDocument({ day: PlainDate.from('2022-09-30') })

  assert({
    given,
    should,
    expected: dayOneCollection.toMarkdown(),
    actual: day.addList('Professional Complete').toMarkdown(),
  })
})

test(`${DayDocument.name}.addDayItems()`, () => {
  const given = 'day w/ collection w/ one item and one item is added'
  const should = 'should add the one item making for two items'

  const dayOneCollection = DayDocument.fromMarkdown(FIXTURES['day-standard-one-item.md'])
  const dayTwoCollection = DayDocument.fromMarkdown(FIXTURES['day-standard-two-items.md'])

  const dayWithNewItem = dayOneCollection.addItem('Professional Complete', '16:00 > Call w/ Bob')

  assert({
    given,
    should,
    expected: dayTwoCollection.toMarkdown(),
    actual: dayWithNewItem.toMarkdown(),
  })
})

test(`${DayDocument.name}.addDayItems() - sort`, () => {
  const given = 'day w/ collection w/ one item and two items are added'
  const should = 'should add the two items making for a total of three items'

  const dayOneCollection = DayDocument.fromMarkdown(FIXTURES['day-standard-one-item.md'])
  const dayThreeCollection = DayDocument.fromMarkdown(FIXTURES['day-standard-three-items.md'])

  let dayWithNew = dayOneCollection.addItem('Professional Complete', '17:00 > Call w/ Sarah')
  dayWithNew = dayWithNew.addItem('Professional Complete', '16:00 > Call w/ Bob')

  assert({
    given,
    should,
    expected: dayThreeCollection.toMarkdown(),
    actual: dayWithNew.toMarkdown(),
  })
})
