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

test('ProjectStore.build: tracks project folder files with injected rel', async () => {
  await setupTestDir()

  try {
    const write = async (relPath: string, contents: string) => {
      const filePath = path.join(TEST_DIR, relPath)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeTextFile(filePath, contents)
    }

    // Overview name differs from folder name -> overview name must win
    await write('open/MyProject/_project/overview.md', '---\nname: My Project\nstatus: open\n---\n\n# My Project')
    await write('open/MyProject/_project/log.md', '# Log')
    await write('open/MyProject/notes.md', '# Notes')
    await write('open/MyProject/research/deep-dive.md', '# Deep dive')
    // Year-nested completed project
    await write('completed/2022/Old-Thing/_project/overview.md', '---\nname: Old Thing\nstatus: completed\n---')
    await write('completed/2022/Old-Thing/retro.md', '---\nrel:\n  - Some Person\n---\n\n# Retro')
    // Project folder without an overview -> folder name fallback
    await write('hold/No-Overview/raw-notes.md', '# Raw')

    const store = await ProjectStore.build(TEST_DIR)

    assert({
      given: 'two overviews and five folder files',
      should: 'index only overviews as projects',
      actual: store.size,
      expected: 2,
    })

    assert({
      given: 'two overviews and five folder files',
      should: 'expose the folder files via getDocuments',
      actual: store.getDocuments().size,
      expected: 5,
    })

    assert({
      given: 'getAll',
      should: 'exclude folder files',
      actual: store.getAll().size,
      expected: 2,
    })

    const relOf = (relPath: string) => Array.from(store.findByPath(path.join(TEST_DIR, relPath))?.rel ?? [])

    assert({
      given: 'a file next to _project/',
      should: 'carry a rel with the overview name, not the folder name',
      actual: relOf('open/MyProject/notes.md'),
      expected: ['projects/My Project'],
    })

    assert({
      given: 'a _project/log.md file',
      should: 'carry the project rel',
      actual: relOf('open/MyProject/_project/log.md'),
      expected: ['projects/My Project'],
    })

    assert({
      given: 'a file in a nested subdir',
      should: 'carry the project rel',
      actual: relOf('open/MyProject/research/deep-dive.md'),
      expected: ['projects/My Project'],
    })

    assert({
      given: 'a file in a year-nested completed project with existing rel',
      should: 'append the project rel to the existing one',
      actual: relOf('completed/2022/Old-Thing/retro.md').includes('projects/Old Thing'),
      expected: true,
    })

    assert({
      given: 'a file in a folder without an overview',
      should: 'fall back to the folder name',
      actual: relOf('hold/No-Overview/raw-notes.md'),
      expected: ['projects/No-Overview'],
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
