import { assert, test } from '#test'
import PeopleStore from './mod.ts'

test('PeopleStore.set: adds a person by path', async () => {
  const store = await PeopleStore.build([])
  const contents = '---\nname: Jane Doe\n---\n\n# Jane Doe'

  store.set('/people/jane-doe.md', contents)

  assert({
    given: 'set with person contents',
    should: 'increase size to 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'set with person contents',
    should: 'find by name',
    actual: store.find('Jane Doe')?.value.name,
    expected: 'Jane Doe',
  })

  assert({
    given: 'set with person contents',
    should: 'find by path',
    actual: store.findByPath('/people/jane-doe.md')?.name,
    expected: 'Jane Doe',
  })
})

test('PeopleStore.set: indexes multiple names', async () => {
  const store = await PeopleStore.build([])
  const contents = '---\nname:\n  - Jane Doe\n  - JD\nalt: Janey\n---\n\n# Jane'

  store.set('/people/jane.md', contents)

  assert({
    given: 'person with multiple names + alt',
    should: 'find by first name',
    actual: store.find('Jane Doe')?.value.name,
    expected: 'Jane Doe',
  })

  assert({
    given: 'person with multiple names + alt',
    should: 'find by second name',
    actual: store.find('JD')?.value.name,
    expected: 'Jane Doe',
  })

  assert({
    given: 'person with multiple names + alt',
    should: 'find by alt name',
    actual: store.find('Janey')?.value.name,
    expected: 'Jane Doe',
  })
})

test('PeopleStore.set: upserts and cleans old name indexes', async () => {
  const store = await PeopleStore.build([])

  store.set('/people/jane.md', '---\nname: Jane Doe\n---\n\n# Jane')
  store.set('/people/jane.md', '---\nname: Jane Smith\n---\n\n# Jane')

  assert({
    given: 'upsert with new name',
    should: 'still have size 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'upsert with new name',
    should: 'find by new name',
    actual: store.find('Jane Smith')?.value.name,
    expected: 'Jane Smith',
  })

  assert({
    given: 'upsert with new name',
    should: 'not find by old name',
    actual: store.find('Jane Doe'),
    expected: undefined,
  })
})

test('PeopleStore.delete: removes person and all name indexes', async () => {
  const store = await PeopleStore.build([])

  store.set('/people/jane.md', '---\nname:\n  - Jane Doe\n  - JD\n---\n\n# Jane')
  store.delete('/people/jane.md')

  assert({
    given: 'delete after set',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'delete after set',
    should: 'not find by name',
    actual: store.find('Jane Doe'),
    expected: undefined,
  })

  assert({
    given: 'delete after set',
    should: 'not find by second name',
    actual: store.find('JD'),
    expected: undefined,
  })

  assert({
    given: 'delete after set',
    should: 'not find by path',
    actual: store.findByPath('/people/jane.md'),
    expected: undefined,
  })
})
