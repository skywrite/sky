import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import { assert, test } from '#test'

test(`${ItemList.name}.update()`, () => {
  const given = 'An ItemList with a title'
  const should = 'Should update with a new title'

  const list = new ItemList({ title: 'Professional Complete' })
  const updatedList = list.update({ title: 'Professional Incomplete' })

  const actual = updatedList.title
  const expected = 'Professional Incomplete'

  assert({ given, should, expected, actual })
})
