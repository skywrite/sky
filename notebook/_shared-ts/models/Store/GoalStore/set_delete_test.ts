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

test('GoalStore.set: ignores non-personal/professional files', () => {
  const store = GoalStore.empty()

  store.set('/goals/other.md', '---\ncategory: Other\n---\n\n# Other')

  assert({
    given: 'set with unknown basename',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
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
