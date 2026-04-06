import { assert, test } from '#test'
import OrgStore from './mod.ts'

test('OrgStore.set: adds an org by path', async () => {
  const store = await OrgStore.build([])
  const contents = '---\nname: Acme Corp\nslug: acme\n---\n\n# Acme Corp'

  store.set('/orgs/acme.md', contents)

  assert({
    given: 'set with org contents',
    should: 'increase size to 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'set with org contents',
    should: 'find by name',
    actual: store.find('Acme Corp')?.value.name,
    expected: 'Acme Corp',
  })

  assert({
    given: 'set with org contents',
    should: 'find by slug',
    actual: store.findBySlug('acme')?.value.name,
    expected: 'Acme Corp',
  })

  assert({
    given: 'set with org contents',
    should: 'find by path',
    actual: store.findByPath('/orgs/acme.md')?.name,
    expected: 'Acme Corp',
  })
})

test('OrgStore.set: upserts and cleans old indexes', async () => {
  const store = await OrgStore.build([])

  store.set('/orgs/acme.md', '---\nname: Acme Corp\nslug: acme\n---\n\n# Acme')
  store.set('/orgs/acme.md', '---\nname: Acme Inc\nslug: acme-inc\n---\n\n# Acme')

  assert({
    given: 'upsert with new name/slug',
    should: 'still have size 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'upsert with new name',
    should: 'find by new name',
    actual: store.find('Acme Inc')?.value.name,
    expected: 'Acme Inc',
  })

  assert({
    given: 'upsert with new name',
    should: 'not find by old name',
    actual: store.find('Acme Corp'),
    expected: undefined,
  })

  assert({
    given: 'upsert with new slug',
    should: 'find by new slug',
    actual: store.findBySlug('acme-inc')?.value.name,
    expected: 'Acme Inc',
  })

  assert({
    given: 'upsert with new slug',
    should: 'not find by old slug',
    actual: store.findBySlug('acme'),
    expected: undefined,
  })
})

test('OrgStore.delete: removes org and all indexes', async () => {
  const store = await OrgStore.build([])

  store.set('/orgs/acme.md', '---\nname: Acme Corp\nslug: acme\n---\n\n# Acme')
  store.delete('/orgs/acme.md')

  assert({
    given: 'delete after set',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'delete after set',
    should: 'not find by name',
    actual: store.find('Acme Corp'),
    expected: undefined,
  })

  assert({
    given: 'delete after set',
    should: 'not find by slug',
    actual: store.findBySlug('acme'),
    expected: undefined,
  })
})
