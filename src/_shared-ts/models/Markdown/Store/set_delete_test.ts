import { assert, test } from '#test'
import MarkdownStore from './mod.ts'

const DIRS = {
  peopleDirs: ['/nb/people'],
  orgDirs: ['/nb/orgs'],
  projectsDir: '/nb/projects',
  decisionsDir: '/nb/decisions',
  goalsDir: '/nb/goals',
  ideasDir: '/nb/ideas',
  placesDir: '/nb/places',
  timeDirs: ['/nb/time'],
}

function buildEmpty(): Promise<MarkdownStore> {
  return MarkdownStore.build(DIRS)
}

test('MarkdownStore.set: routes person to PeopleStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/people/jane.md', '---\nname: Jane Doe\n---\n\n# Jane')

  assert({
    given: 'set person file',
    should: 'find in people store',
    actual: store.people.find('Jane Doe')?.value.name,
    expected: 'Jane Doe',
  })
})

test('MarkdownStore.set: routes org to OrgStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/orgs/acme.md', '---\nname: Acme Corp\nslug: acme\n---\n\n# Acme')

  assert({
    given: 'set org file',
    should: 'find in org store',
    actual: store.orgs.find('Acme Corp')?.value.name,
    expected: 'Acme Corp',
  })
})

test('MarkdownStore.set: routes project to ProjectStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/projects/open/Foo/_project/overview.md', '---\nname: Foo\nstatus: open\n---\n\n# Foo')

  assert({
    given: 'set project overview',
    should: 'find in project store',
    actual: store.projects.find('Foo')?.value.name,
    expected: 'Foo',
  })
})

test('MarkdownStore.set: routes decision to DecisionStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/decisions/2026/03/hire.md', '---\nname: hire\n---\n\n# Hire')

  assert({
    given: 'set decision file',
    should: 'find in decision store',
    actual: store.decisions.find('hire')?.value.name,
    expected: 'hire',
  })
})

test('MarkdownStore.set: routes goal to GoalStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/goals/personal.md', '---\ncategory: Personal\n---\n\n# Goals')

  assert({
    given: 'set goal file',
    should: 'find in goal store',
    actual: store.goals.getPersonal()?.category,
    expected: 'Personal',
  })
})

test('MarkdownStore.set: routes idea to IdeaStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/ideas/2026/draft/03/cool.md', '---\nname: cool\n---\n\n# Cool')

  assert({
    given: 'set idea file',
    should: 'find in idea store',
    actual: store.ideas.find('cool')?.value.name,
    expected: 'cool',
  })
})

test('MarkdownStore.set: routes place to PlaceStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/places/US/NY/drink/Bar.md', '---\nname: Bar\n---\n\n# Bar')

  assert({
    given: 'set place file',
    should: 'find in place store',
    actual: store.places.find('Bar')?.value.name,
    expected: 'Bar',
  })
})

test('MarkdownStore.set: routes time doc to DocumentStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/time/2026/W10/03-04/notes.md', '---\ntitle: Notes\n---\n\n# Notes')

  assert({
    given: 'set time doc',
    should: 'find in time store',
    actual: store.time.findByPath('/nb/time/2026/W10/03-04/notes.md')?.yaml['title'],
    expected: 'Notes',
  })
})

test('MarkdownStore.delete: routes person to PeopleStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/people/jane.md', '---\nname: Jane Doe\n---\n\n# Jane')
  store.delete('/nb/people/jane.md')

  assert({
    given: 'delete person file',
    should: 'not find in people store',
    actual: store.people.find('Jane Doe'),
    expected: undefined,
  })
})

test('MarkdownStore.delete: routes org to OrgStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/orgs/acme.md', '---\nname: Acme Corp\nslug: acme\n---\n\n# Acme')
  store.delete('/nb/orgs/acme.md')

  assert({
    given: 'delete org file',
    should: 'not find in org store',
    actual: store.orgs.find('Acme Corp'),
    expected: undefined,
  })
})

test('MarkdownStore.delete: routes project to ProjectStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/projects/open/Foo/_project/overview.md', '---\nname: Foo\nstatus: open\n---\n\n# Foo')
  store.delete('/nb/projects/open/Foo/_project/overview.md')

  assert({
    given: 'delete project overview',
    should: 'not find in project store',
    actual: store.projects.find('Foo'),
    expected: undefined,
  })
})

test('MarkdownStore.delete: routes decision to DecisionStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/decisions/2026/03/hire.md', '---\nname: hire\n---\n\n# Hire')
  store.delete('/nb/decisions/2026/03/hire.md')

  assert({
    given: 'delete decision file',
    should: 'not find in decision store',
    actual: store.decisions.find('hire'),
    expected: undefined,
  })
})

test('MarkdownStore.delete: routes goal to GoalStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/goals/personal.md', '---\ncategory: Personal\n---\n\n# Goals')
  store.delete('/nb/goals/personal.md')

  assert({
    given: 'delete goal file',
    should: 'not find in goal store',
    actual: store.goals.getPersonal(),
    expected: undefined,
  })
})

test('MarkdownStore.delete: routes idea to IdeaStore', async () => {
  const store = await buildEmpty()

  store.set('/nb/ideas/2026/draft/03/cool.md', '---\nname: cool\n---\n\n# Cool')
  store.delete('/nb/ideas/2026/draft/03/cool.md')

  assert({
    given: 'delete idea file',
    should: 'not find in idea store',
    actual: store.ideas.find('cool'),
    expected: undefined,
  })
})

test('MarkdownStore.set: updates resolve for person', async () => {
  const store = await buildEmpty()

  store.set('/nb/people/jane.md', '---\nname: Jane Doe\n---\n\n# Jane')

  const resolved = store.resolve('Jane Doe')
  assert({
    given: 'set person then resolve',
    should: 'resolve as person type',
    actual: resolved.type,
    expected: 'person',
  })
})

test('MarkdownStore.delete: unresolvable after delete', async () => {
  const store = await buildEmpty()

  store.set('/nb/people/jane.md', '---\nname: Jane Doe\n---\n\n# Jane')
  store.delete('/nb/people/jane.md')

  const resolved = store.resolve('Jane Doe')
  assert({
    given: 'delete person then resolve',
    should: 'be unresolved',
    actual: resolved.type,
    expected: 'unresolved',
  })
})

test('MarkdownStore.set: no-op for unrecognized directory', async () => {
  const store = await buildEmpty()

  store.set('/unknown/dir/file.md', '---\nname: Orphan\n---\n\n# Orphan')

  assert({
    given: 'set in unrecognized dir',
    should: 'not appear in any store',
    actual:
      store.people.size +
      store.orgs.size +
      store.projects.size +
      store.decisions.size +
      store.goals.size +
      store.ideas.size +
      store.places.size +
      store.time.size,
    expected: 0,
  })
})

test('MarkdownStore.version: routed set and delete bump it', async () => {
  const store = await buildEmpty()

  store.set('/nb/people/jane.md', '---\nname: Jane Doe\n---\n\n# Jane')
  const afterSet = store.version
  store.delete('/nb/people/jane.md')

  assert({
    given: 'a routed set',
    should: 'bump the version',
    actual: afterSet,
    expected: 1,
  })

  assert({
    given: 'a routed delete',
    should: 'bump the version again',
    actual: store.version,
    expected: 2,
  })
})

test('MarkdownStore.version: unrouted set/delete leave it unchanged', async () => {
  const store = await buildEmpty()

  store.set('/unknown/dir/file.md', '---\nname: Orphan\n---\n\n# Orphan')
  store.delete('/unknown/dir/file.md')

  assert({
    given: 'set/delete outside every configured dir',
    should: 'not bump the version (no cache invalidation for no-ops)',
    actual: store.version,
    expected: 0,
  })
})
