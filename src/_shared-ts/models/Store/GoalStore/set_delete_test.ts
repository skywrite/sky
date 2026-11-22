import { assert, test } from '#test'
import GoalStore from './mod.ts'

test('GoalStore.set: adds personal goal', () => {
  const store = GoalStore.empty()
  const contents = '---\ncategory: Personal\n---\n\n# Personal Goals'

  store.set('/goals/personal.md', contents)

  assert({
    given: 'set personal.md',
    should: 'increase size to 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'set personal.md',
    should: 'return personal goals',
    actual: store.getPersonal()?.category,
    expected: 'Personal',
  })

  assert({
    given: 'set personal.md',
    should: 'return undefined for professional',
    actual: store.getProfessional(),
    expected: undefined,
  })
})

test('GoalStore.set: adds professional goal', () => {
  const store = GoalStore.empty()
  const contents = '---\ncategory: Professional\n---\n\n# Professional Goals'

  store.set('/goals/professional.md', contents)

  assert({
    given: 'set professional.md',
    should: 'increase size to 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'set professional.md',
    should: 'return professional goals',
    actual: store.getProfessional()?.category,
    expected: 'Professional',
  })
})

test('GoalStore.set: upserts personal goal', () => {
  const store = GoalStore.empty()

  store.set('/goals/personal.md', '---\ncategory: Personal\n---\n\n# V1')
  store.set('/goals/personal.md', '---\ncategory: Personal\n---\n\n# V2')

  assert({
    given: 'upsert personal.md',
    should: 'still have size 1',
    actual: store.size,
    expected: 1,
  })
})

test('GoalStore.set: a goal file of any name loads', () => {
  const store = GoalStore.empty()

  store.set('/goals/active/Launch-Atlas.md', '---\ncategory: Professional\n---\n\n# Launch Atlas')

  assert({
    given: 'a one-goal file under active/',
    should: 'load it, findable by its file name in any case',
    actual: [store.size, store.find('launch-atlas')?.path, store.find('Launch-Atlas')?.value.title],
    expected: [1, '/goals/active/Launch-Atlas.md', 'Launch Atlas'],
  })
})

test('GoalStore.set: moving a goal to archived/ changes its status, not its name', () => {
  const store = GoalStore.empty()
  const contents = '---\ntitle: Launch Atlas\n---\n\nShip it to three pilot teams.'

  store.set('/goals/active/Launch-Atlas.md', contents)
  store.delete('/goals/active/Launch-Atlas.md')
  store.set('/goals/archived/2026/Launch-Atlas.md', contents)

  assert({
    given: 'a goal file moved from active/ to archived/<year>/',
    should: 'leave the active goals and stay findable by the same name',
    actual: [store.getActive().size, store.getArchived().size, store.find('Launch-Atlas')?.path],
    expected: [0, 1, '/goals/archived/2026/Launch-Atlas.md'],
  })
})

test('GoalStore.delete: removes personal goal', () => {
  const store = GoalStore.empty()

  store.set('/goals/personal.md', '---\ncategory: Personal\n---\n\n# Goals')
  store.delete('/goals/personal.md')

  assert({
    given: 'delete personal.md',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'delete personal.md',
    should: 'return undefined',
    actual: store.getPersonal(),
    expected: undefined,
  })
})

test('GoalStore.delete: removes professional goal', () => {
  const store = GoalStore.empty()

  store.set('/goals/professional.md', '---\ncategory: Professional\n---\n\n# Goals')
  store.delete('/goals/professional.md')

  assert({
    given: 'delete professional.md',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'delete professional.md',
    should: 'return undefined',
    actual: store.getProfessional(),
    expected: undefined,
  })
})

test('GoalStore.delete: findByPath returns undefined after delete', () => {
  const store = GoalStore.empty()

  store.set('/goals/personal.md', '---\ncategory: Personal\n---\n\n# Goals')
  store.delete('/goals/personal.md')

  assert({
    given: 'delete personal.md',
    should: 'findByPath returns undefined',
    actual: store.findByPath('/goals/personal.md'),
    expected: undefined,
  })
})
