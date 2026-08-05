import { mkdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { writeTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import IdeaStore from './mod.ts'

const TEST_DIR = '/tmp/idea-store-test'

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

test('IdeaStore.empty: creates empty store', () => {
  const store = IdeaStore.empty()

  assert({
    given: 'empty store',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })
})

test('IdeaStore.build: indexes idea by name', async () => {
  await setupTestDir()

  try {
    const ideaDir = path.join(TEST_DIR, '2026/draft/03')
    await mkdir(ideaDir, { recursive: true })

    const contents = ['---', 'name: ai-powered-crm', '---', '', '# AI-Powered CRM'].join('\n')

    const filePath = path.join(ideaDir, 'ai-powered-crm.md')
    await writeTextFile(filePath, contents)

    const store = await IdeaStore.build(TEST_DIR)

    assert({
      given: 'store with one idea',
      should: 'have size 1',
      actual: store.size,
      expected: 1,
    })

    const byName = store.find('ai-powered-crm')
    assert({
      given: 'find by name',
      should: 'return the idea',
      actual: byName?.value.name,
      expected: 'ai-powered-crm',
    })

    const byPath = store.findByPath(filePath)
    assert({
      given: 'find by file path',
      should: 'return the idea',
      actual: byPath?.name,
      expected: 'ai-powered-crm',
    })
  } finally {
    await cleanupTestDir()
  }
})

test('IdeaStore.build: derives status from path', async () => {
  await setupTestDir()

  try {
    const draftDir = path.join(TEST_DIR, '2026/draft/03')
    const exploringDir = path.join(TEST_DIR, '2026/exploring')
    await mkdir(draftDir, { recursive: true })
    await mkdir(exploringDir, { recursive: true })

    await writeTextFile(path.join(draftDir, 'idea-a.md'), '---\nname: idea-a\n---\n\n# Idea A')
    await writeTextFile(path.join(exploringDir, 'idea-b.md'), '---\nname: idea-b\n---\n\n# Idea B')

    const store = await IdeaStore.build(TEST_DIR)

    assert({
      given: 'store with draft and exploring ideas',
      should: 'have size 2',
      actual: store.size,
      expected: 2,
    })

    assert({
      given: 'getDraft',
      should: 'return 1 draft idea',
      actual: store.getDraft().size,
      expected: 1,
    })

    assert({
      given: 'getExploring',
      should: 'return 1 exploring idea',
      actual: store.getExploring().size,
      expected: 1,
    })

    assert({
      given: 'getActioned',
      should: 'return 0',
      actual: store.getActioned().size,
      expected: 0,
    })

    assert({
      given: 'getArchived',
      should: 'return 0',
      actual: store.getArchived().size,
      expected: 0,
    })
  } finally {
    await cleanupTestDir()
  }
})

test('IdeaStore.build: skips ideas.md and hidden files', async () => {
  await setupTestDir()

  try {
    await writeTextFile(path.join(TEST_DIR, 'ideas.md'), '---\ntitle: Ideas\n---\n\n# Ideas')
    await writeTextFile(path.join(TEST_DIR, '.hidden.md'), '---\nname: hidden\n---\n\n# Hidden')

    const store = await IdeaStore.build(TEST_DIR)

    assert({
      given: 'only index and hidden files',
      should: 'have size 0',
      actual: store.size,
      expected: 0,
    })
  } finally {
    await cleanupTestDir()
  }
})

test('IdeaStore.statusFromPath: extracts status from path', () => {
  assert({
    given: 'path with /draft/',
    should: 'return draft',
    actual: IdeaStore.statusFromPath('/ideas/2026/draft/03/foo.md'),
    expected: 'draft',
  })

  assert({
    given: 'path with /exploring/',
    should: 'return exploring',
    actual: IdeaStore.statusFromPath('/ideas/2026/exploring/foo.md'),
    expected: 'exploring',
  })

  assert({
    given: 'path with /actioned/',
    should: 'return actioned',
    actual: IdeaStore.statusFromPath('/ideas/2026/actioned/foo.md'),
    expected: 'actioned',
  })

  assert({
    given: 'path with /archived/',
    should: 'return archived',
    actual: IdeaStore.statusFromPath('/ideas/2026/archived/foo.md'),
    expected: 'archived',
  })

  assert({
    given: 'path without status segment',
    should: 'default to draft',
    actual: IdeaStore.statusFromPath('/ideas/2026/foo.md'),
    expected: 'draft',
  })
})

test('IdeaStore.find: returns undefined for unknown name', () => {
  const store = IdeaStore.empty()

  assert({
    given: 'empty store',
    should: 'return undefined for any name',
    actual: store.find('unknown-idea'),
    expected: undefined,
  })
})

test('IdeaStore.getAll: returns empty collection for empty store', () => {
  const store = IdeaStore.empty()

  assert({
    given: 'empty store',
    should: 'return empty collection',
    actual: store.getAll().isEmpty,
    expected: true,
  })
})
