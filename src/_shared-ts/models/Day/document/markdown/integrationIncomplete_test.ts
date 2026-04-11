import { assert, loadFixturesSync, test } from '#test'
import * as path from 'node:path'
import DayDocument from '#shared/models/Day/mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test(`${DayDocument.name} - integration - incomplete`, () => {
  const fixtureTodos = FIXTURES['day-todos-with-links.md']
  const fixtureIncomplete = FIXTURES['day-incomplete-with-links.md']

  const dayTodos = DayDocument.fromMarkdown(fixtureTodos)
  const dayIncomplete = DayDocument.fromMarkdown(fixtureIncomplete)

  // ensure no issues on roundtripping
  assert({ expected: fixtureTodos, actual: dayTodos.toMarkdown() })
  assert({ expected: fixtureIncomplete, actual: dayIncomplete.toMarkdown() })

  const listDayTodos = dayTodos.lists.find((list) => list.title === 'Professional Todos')
  if (!listDayTodos) throw new Error('Expected list "Professional Todos"')

  const listDayNotDone = listDayTodos.filter(DayDocument.isItemNotDone)
  const listDayDone = listDayTodos.filter(DayDocument.isItemDone)

  // assert({ expected: '', actual: listDayNotDone.update({ title: 'fuck' }).toMarkdown() })

  const actualDayIncomplete = dayTodos
    .replaceList('Professional Todos', listDayDone)
    .addList(listDayNotDone.update({ title: 'Professional Incomplete' }))

  // console.log(actualDayIncomplete.toMarkdown())

  assert({
    given: 'A todo list of incomplete items',
    should: 'place the incomplete items in "Incomplete"',
    actual: actualDayIncomplete.toMarkdown(),
    expected: fixtureIncomplete,
  })
})
