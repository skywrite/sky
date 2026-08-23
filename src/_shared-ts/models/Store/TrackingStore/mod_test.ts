import { mkdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { writeTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import TrackingStore from './mod.ts'

const TEST_DIR = '/tmp/tracking-store-test'

async function setupTestDir() {
  try {
    await rm(TEST_DIR, { recursive: true })
  } catch {
    // ignore
  }
  await mkdir(path.join(TEST_DIR, 'active'), { recursive: true })
  await mkdir(path.join(TEST_DIR, 'archived'), { recursive: true })
}

async function cleanupTestDir() {
  try {
    await rm(TEST_DIR, { recursive: true })
  } catch {
    // ignore
  }
}

const HYDRATION = [
  '---',
  'name: hydration',
  'title: Hydration',
  'question: How much water today?',
  'ask: morning',
  'category: health',
  'columns:',
  '  - name: oz',
  '    type: number',
  '    unit: oz',
  '    aggregate: sum',
  '---',
  '',
  '# Hydration',
  '',
  'Dehydration masquerades as fatigue.',
].join('\n')

const PAGES = ['---', 'name: pages', 'title: Pages read', '---', '', '# Pages read'].join('\n')

test('TrackingStore.empty: creates empty store', () => {
  const store = TrackingStore.empty()

  assert({
    given: 'empty store',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })
})

test('TrackingStore.build: loads definitions with path-derived status', async () => {
  await setupTestDir()

  try {
    await writeTextFile(path.join(TEST_DIR, 'active', 'hydration.md'), HYDRATION)
    await writeTextFile(path.join(TEST_DIR, 'archived', 'pages.md'), PAGES)

    const store = await TrackingStore.build(TEST_DIR)

    assert({
      given: 'a tracking dir with one active and one archived definition',
      should: 'load both',
      actual: store.size,
      expected: 2,
    })
    assert({
      given: 'the active subset',
      should: 'contain only the active definition',
      actual: store.getActive().toArray().length,
      expected: 1,
    })
    assert({
      given: 'the archived subset',
      should: 'contain only the archived definition',
      actual: store.getArchived().toArray().length,
      expected: 1,
    })

    const found = store.find('Hydration')
    assert({
      given: 'a case-insensitive name lookup',
      should: 'find the definition',
      actual: found?.value.question,
      expected: 'How much water today?',
    })
    assert({
      given: 'a loaded definition',
      should: 'expose its column schema',
      actual: found?.value.columns[0]?.unit,
      expected: 'oz',
    })
  } finally {
    await cleanupTestDir()
  }
})

test('TrackingStore.build: missing dir yields empty store', async () => {
  const store = await TrackingStore.build('/tmp/tracking-store-test-nonexistent')

  assert({
    given: 'a nonexistent tracking dir',
    should: 'build an empty store',
    actual: store.size,
    expected: 0,
  })
})

test('TrackingStore.set/delete: keeps lookups in sync', async () => {
  const store = TrackingStore.empty()
  const filePath = path.join(TEST_DIR, 'active', 'hydration.md')

  store.set(filePath, HYDRATION)
  assert({
    given: 'a set() definition',
    should: 'be findable by name',
    actual: store.find('hydration')?.path,
    expected: filePath,
  })

  store.set(filePath, HYDRATION.replace('How much water today?', 'Water intake?'))
  assert({
    given: 'a re-set() definition',
    should: 'replace, not duplicate',
    actual: store.size,
    expected: 1,
  })
  assert({
    given: 'a re-set() definition',
    should: 'serve the new content',
    actual: store.find('hydration')?.value.question,
    expected: 'Water intake?',
  })

  store.delete(filePath)
  assert({
    given: 'a delete()d definition',
    should: 'be gone from all lookups',
    actual: `${store.size}|${store.find('hydration') === undefined}|${store.findByPath(filePath) === undefined}`,
    expected: '0|true|true',
  })
})
