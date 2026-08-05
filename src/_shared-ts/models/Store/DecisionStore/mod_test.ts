import { mkdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { writeTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import DecisionStore from './mod.ts'

const TEST_DIR = '/tmp/decision-store-test'

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

test('DecisionStore.empty: creates empty store', () => {
  const store = DecisionStore.empty()

  assert({
    given: 'empty store',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })
})

test('DecisionStore.build: indexes decision by name', async () => {
  await setupTestDir()

  try {
    const decisionDir = path.join(TEST_DIR, '2026/03')
    await mkdir(decisionDir, { recursive: true })

    const contents = [
      '---',
      'name: hire-backend-lead',
      'summary: Hire a backend engineering lead',
      '---',
      '',
      '# Hire Backend Lead',
    ].join('\n')

    const filePath = path.join(decisionDir, 'hire-backend-lead.md')
    await writeTextFile(filePath, contents)

    const store = await DecisionStore.build(TEST_DIR)

    assert({
      given: 'store with one decision',
      should: 'have size 1',
      actual: store.size,
      expected: 1,
    })

    const byName = store.find('hire-backend-lead')
    assert({
      given: 'find by name',
      should: 'return the decision',
      actual: byName?.value.name,
      expected: 'hire-backend-lead',
    })

    const byPath = store.findByPath(filePath)
    assert({
      given: 'find by file path',
      should: 'return the decision',
      actual: byPath?.name,
      expected: 'hire-backend-lead',
    })

    assert({
      given: 'decision without resolved date',
      should: 'appear in pending list',
      actual: store.getPending().size,
      expected: 1,
    })

    assert({
      given: 'decision without resolved date',
      should: 'not appear in decided list',
      actual: store.getDecided().size,
      expected: 0,
    })
  } finally {
    await cleanupTestDir()
  }
})

test('DecisionStore.build: skips decisions.md index file', async () => {
  await setupTestDir()

  try {
    const contents = '---\ntitle: Decisions\n---\n\n# Decisions'
    await writeTextFile(path.join(TEST_DIR, 'decisions.md'), contents)

    const store = await DecisionStore.build(TEST_DIR)

    assert({
      given: 'only a decisions.md index file',
      should: 'have size 0',
      actual: store.size,
      expected: 0,
    })
  } finally {
    await cleanupTestDir()
  }
})

test('DecisionStore.find: returns undefined for unknown name', () => {
  const store = DecisionStore.empty()

  assert({
    given: 'empty store',
    should: 'return undefined for any name',
    actual: store.find('unknown-decision'),
    expected: undefined,
  })
})

test('DecisionStore.getAll: returns empty collection for empty store', () => {
  const store = DecisionStore.empty()

  assert({
    given: 'empty store',
    should: 'return empty collection',
    actual: store.getAll().isEmpty,
    expected: true,
  })
})
