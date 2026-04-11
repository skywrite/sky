import { assert, test } from '#test'
import ProjectStore from './mod.ts'

const OVERVIEW_PATH = '/projects/open/MyProject/_project/overview.md'
const OVERVIEW_CONTENTS = '---\nname: My Project\nstatus: open\n---\n\n# My Project'

test('ProjectStore.set: adds overview as fully indexed project', () => {
  const store = ProjectStore.empty()

  store.set(OVERVIEW_PATH, OVERVIEW_CONTENTS)

  assert({
    given: 'set with overview file',
    should: 'increase size to 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'set with overview file',
    should: 'find by name',
    actual: store.find('My Project')?.value.name,
    expected: 'My Project',
  })

  assert({
    given: 'set with overview file',
    should: 'have correct projectDir',
    actual: store.find('My Project')?.projectDir,
    expected: '/projects/open/MyProject',
  })

  assert({
    given: 'set with overview file',
    should: 'appear in open status',
    actual: store.getOpen().size,
    expected: 1,
  })
})

test('ProjectStore.set: adds non-overview as path-only document', () => {
  const store = ProjectStore.empty()
  const notesPath = '/projects/open/MyProject/notes.md'

  store.set(notesPath, '---\ntitle: Notes\n---\n\n# Notes')

  assert({
    given: 'set with non-overview file',
    should: 'not increase project count',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'set with non-overview file',
    should: 'find by path',
    actual: store.findByPath(notesPath)?.yaml['title'],
    expected: 'Notes',
  })
})

test('ProjectStore.set: upserts and cleans old indexes', () => {
  const store = ProjectStore.empty()

  store.set(OVERVIEW_PATH, OVERVIEW_CONTENTS)
  store.set(OVERVIEW_PATH, '---\nname: My Project v2\nstatus: hold\n---\n\n# V2')

  assert({
    given: 'upsert overview',
    should: 'still have size 1',
    actual: store.size,
    expected: 1,
  })

  assert({
    given: 'upsert with new name',
    should: 'find by new name',
    actual: store.find('My Project v2')?.value.name,
    expected: 'My Project v2',
  })

  assert({
    given: 'upsert with new name',
    should: 'not find by old name',
    actual: store.find('My Project'),
    expected: undefined,
  })

  assert({
    given: 'upsert with new status',
    should: 'remove from old status',
    actual: store.getOpen().size,
    expected: 0,
  })

  assert({
    given: 'upsert with new status',
    should: 'appear in new status',
    actual: store.getOnHold().size,
    expected: 1,
  })
})

test('ProjectStore.delete: removes project and all indexes', () => {
  const store = ProjectStore.empty()

  store.set(OVERVIEW_PATH, OVERVIEW_CONTENTS)
  store.delete(OVERVIEW_PATH)

  assert({
    given: 'delete after set',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'delete after set',
    should: 'not find by name',
    actual: store.find('My Project'),
    expected: undefined,
  })

  assert({
    given: 'delete after set',
    should: 'remove from status list',
    actual: store.getOpen().size,
    expected: 0,
  })

  assert({
    given: 'delete after set',
    should: 'not find by path',
    actual: store.findByPath(OVERVIEW_PATH),
    expected: undefined,
  })
})
