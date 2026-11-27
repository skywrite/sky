import { assert, test } from '#test'
import DecisionStore from './mod.ts'

test('DecisionStore.set: adds a decision by path', () => {
  const store = DecisionStore.empty()
  const contents = '---\nname: hire-backend-lead\nsummary: Hire a backend lead\n---\n\n# Hire Backend Lead'

  store.set('/decisions/2026/03/hire-backend-lead.md', contents)

  assert({
    given: 'set with decision contents',
    should: 'increase size to 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'set with decision contents',
    should: 'find by name',
    actual: store.find('hire-backend-lead')?.value.name,
    expected: 'hire-backend-lead',
  })

  assert({
    given: 'set with decision contents',
    should: 'find by path',
    actual: store.findByPath('/decisions/2026/03/hire-backend-lead.md')?.name,
    expected: 'hire-backend-lead',
  })

  assert({
    given: 'pending decision',
    should: 'appear in pending list',
    actual: store.getPending().size,
    expected: 1,
  })
})

test('DecisionStore.set: upserts and cleans old indexes', () => {
  const store = DecisionStore.empty()
  const filePath = '/decisions/2026/03/hire-backend-lead.md'

  store.set(filePath, '---\nname: hire-backend-lead\n---\n\n# V1')
  store.set(filePath, '---\nname: hire-frontend-lead\n---\n\n# V2')

  assert({
    given: 'upsert with new name',
    should: 'still have size 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'upsert with new name',
    should: 'find by new name',
    actual: store.find('hire-frontend-lead')?.value.name,
    expected: 'hire-frontend-lead',
  })

  assert({
    given: 'upsert with new name',
    should: 'not find by old name',
    actual: store.find('hire-backend-lead'),
    expected: undefined,
  })
})

test('DecisionStore.delete: removes decision and all indexes', () => {
  const store = DecisionStore.empty()
  const filePath = '/decisions/2026/03/hire-backend-lead.md'

  store.set(filePath, '---\nname: hire-backend-lead\n---\n\n# Decision')
  store.delete(filePath)

  assert({
    given: 'delete after set',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'delete after set',
    should: 'not find by name',
    actual: store.find('hire-backend-lead'),
    expected: undefined,
  })

  assert({
    given: 'delete after set',
    should: 'not find by path',
    actual: store.findByPath(filePath),
    expected: undefined,
  })
})

test('DecisionStore.getInForce: a decision in force is neither pending nor lost among the decided', () => {
  const store = DecisionStore.empty()
  store.set('/decisions/2026/pending/03/Choose-Vendor.md', '---\nname: Choose-Vendor\n---\n\n# Choose a vendor')
  store.set(
    '/decisions/2026/in-force/01/No-Friday-Releases.md',
    '---\nname: No-Friday-Releases\ndecided: 2026-01-12T09:00:00-06:00[America/Chicago]\ninForce: true\n---\n\n# No releases on Fridays',
  )
  store.set(
    '/decisions/2026/decided/02/Ship-Widget.md',
    '---\nname: Ship-Widget\ndecided: 2026-02-03T09:00:00-06:00[America/Chicago]\n---\n\n# Ship Widget',
  )
  const names = (docs: { getAll(): Array<{ name: string }> }) => docs.getAll().map((d) => d.name)

  assert({
    given: 'one pending, one in force and one done decision',
    should: 'list the in-force one alone, keep it out of pending, and count it among the decided',
    actual: [names(store.getInForce()), names(store.getPending()), names(store.getDecided()).sort()],
    expected: [['No-Friday-Releases'], ['Choose-Vendor'], ['No-Friday-Releases', 'Ship-Widget']],
  })
})
