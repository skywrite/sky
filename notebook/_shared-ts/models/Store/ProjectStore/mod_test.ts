import { assert, test } from '#test'
import ProjectStore from './mod.ts'
import { writeTextFile } from '#shared/fs/mod.ts'
import * as path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'

const TEST_DIR = '/tmp/project-store-test'

async function setupTestDir() {
  try {
    await rm(TEST_DIR, { recursive: true })
  } catch {
    // ignore
  }
  await mkdir(TEST_DIR, { recursive: true })
}

async function cleanupTestDir() {
  try {
    await rm(TEST_DIR, { recursive: true })
  } catch {
    // ignore
  }
}

test('ProjectStore.empty: creates empty store', () => {
  const store = ProjectStore.empty()

  assert({
    given: 'empty store',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })
})

test('ProjectStore.build: indexes project by name and status', async () => {
  await setupTestDir()

  try {
    const overviewDir = path.join(TEST_DIR, 'open/MyProject/_project')
    await mkdir(overviewDir, { recursive: true })

    const contents = ['---', 'name: My Project', 'status: open', '---', '', '# My Project'].join('\n')

    const overviewPath = path.join(overviewDir, 'overview.md')
    await writeTextFile(overviewPath, contents)

    const store = await ProjectStore.build(TEST_DIR)

    assert({
      given: 'store with one project',
      should: 'have size 1',
      actual: store.size,
      expected: 1,
    })

    const byName = store.find('My Project')
    assert({
      given: 'find by name',
      should: 'return the project',
      actual: byName?.value.name,
      expected: 'My Project',
    })

    assert({
      given: 'find by name',
      should: 'include project directory',
      actual: byName?.projectDir,
      expected: path.join(TEST_DIR, 'open/MyProject'),
    })

    const byPath = store.findByPath(overviewPath)
    assert({
      given: 'find by file path',
      should: 'return the project',
      actual: byPath?.yaml['name'],
      expected: 'My Project',
    })

    assert({
      given: 'getOpen',
      should: 'return the open project',
      actual: store.getOpen().size,
      expected: 1,
    })

    assert({
      given: 'getOnHold',
      should: 'return empty collection',
      actual: store.getOnHold().size,
      expected: 0,
    })
  } finally {
    await cleanupTestDir()
  }
})

test('ProjectStore.find: returns undefined for unknown name', () => {
  const store = ProjectStore.empty()

  assert({
    given: 'empty store',
    should: 'return undefined for any name',
    actual: store.find('Unknown Project'),
    expected: undefined,
  })
})

test('ProjectStore.getAll: returns empty collection for empty store', () => {
  const store = ProjectStore.empty()

  assert({
    given: 'empty store',
    should: 'return empty collection',
    actual: store.getAll().isEmpty,
    expected: true,
  })
})
