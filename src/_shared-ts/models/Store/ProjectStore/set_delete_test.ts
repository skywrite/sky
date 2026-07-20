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

test('ProjectStore.set: adds non-overview as rel-injected project document', () => {
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

  assert({
    given: 'set with non-overview file and no indexed overview',
    should: 'inject rel from the folder name',
    actual: Array.from(store.findByPath(notesPath)?.rel ?? []),
    expected: ['projects/MyProject'],
  })

  assert({
    given: 'set with non-overview file',
    should: 'appear in getDocuments',
    actual: store.getDocuments().size,
    expected: 1,
  })
})

test('ProjectStore.set: file rel prefers indexed overview name', () => {
  const store = ProjectStore.empty()

  store.set(OVERVIEW_PATH, OVERVIEW_CONTENTS)
  store.set('/projects/open/MyProject/notes.md', '# Notes')

  assert({
    given: 'overview indexed before the file',
    should: 'inject rel with the overview name',
    actual: Array.from(store.findByPath('/projects/open/MyProject/notes.md')?.rel ?? []),
    expected: ['projects/My Project'],
  })
})

test('ProjectStore.set: upserting a file keeps one getDocuments entry', () => {
  const store = ProjectStore.empty()
  const notesPath = '/projects/open/MyProject/notes.md'

  store.set(notesPath, '# v1')
  store.set(notesPath, '# v2')

  assert({
    given: 'same file set twice',
    should: 'keep a single entry',
    actual: store.getDocuments().size,
    expected: 1,
  })
})

test('ProjectStore.delete: removes file from getDocuments and byPath', () => {
  const store = ProjectStore.empty()
  const notesPath = '/projects/open/MyProject/notes.md'

  store.set(notesPath, '# Notes')
  store.delete(notesPath)

  assert({
    given: 'delete after set',
    should: 'remove from getDocuments',
    actual: store.getDocuments().size,
    expected: 0,
  })

  assert({
    given: 'delete after set',
    should: 'remove from byPath',
    actual: store.findByPath(notesPath),
    expected: undefined,
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
