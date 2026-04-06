import { assert, test } from '#test'
import PlaceStore from './mod.ts'
import { writeTextFile } from '#shared/fs/mod.ts'
import * as path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'

const TEST_DIR = '/tmp/place-store-set-delete-test'

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

test('PlaceStore.set: adds a place by path', async () => {
  await setupTestDir()

  try {
    // Build with real dir so placesDir is stored
    const store = await PlaceStore.build(TEST_DIR)
    const filePath = path.join(TEST_DIR, 'US/NY/drink/Ty-Bar.md')
    const contents = '---\nname: Ty Bar\n---\n\n# Ty Bar'

    store.set(filePath, contents)

    assert({
      given: 'set with place contents',
      should: 'increase size to 1',
      actual: store.size,
      expected: 1,
    })

    assert({
      given: 'set with place contents',
      should: 'find by name',
      actual: store.find('Ty Bar')?.value.name,
      expected: 'Ty Bar',
    })

    assert({
      given: 'set with place contents',
      should: 'find by path',
      actual: store.findByPath(filePath)?.name,
      expected: 'Ty Bar',
    })

    assert({
      given: 'set with place contents',
      should: 'find by placePath',
      actual: store.findByPlacePath('places/US/NY/drink/Ty-Bar')?.value.name,
      expected: 'Ty Bar',
    })
  } finally {
    await cleanupTestDir()
  }
})

test('PlaceStore.set: upserts and cleans old indexes', async () => {
  await setupTestDir()

  try {
    const store = await PlaceStore.build(TEST_DIR)
    const filePath = path.join(TEST_DIR, 'US/NY/drink/Ty-Bar.md')

    store.set(filePath, '---\nname: Ty Bar\n---\n\n# V1')
    store.set(filePath, '---\nname: Ty Bar Lounge\n---\n\n# V2')

    assert({
      given: 'upsert with new name',
      should: 'still have size 1',
      actual: store.size,
      expected: 1,
    })

    assert({
      given: 'upsert with new name',
      should: 'find by new name',
      actual: store.find('Ty Bar Lounge')?.value.name,
      expected: 'Ty Bar Lounge',
    })

    assert({
      given: 'upsert with new name',
      should: 'not find by old name',
      actual: store.find('Ty Bar'),
      expected: undefined,
    })
  } finally {
    await cleanupTestDir()
  }
})

test('PlaceStore.delete: removes place and all indexes', async () => {
  await setupTestDir()

  try {
    const store = await PlaceStore.build(TEST_DIR)
    const filePath = path.join(TEST_DIR, 'US/NY/drink/Ty-Bar.md')

    store.set(filePath, '---\nname: Ty Bar\n---\n\n# Place')
    store.delete(filePath)

    assert({
      given: 'delete after set',
      should: 'have size 0',
      actual: store.size,
      expected: 0,
    })

    assert({
      given: 'delete after set',
      should: 'not find by name',
      actual: store.find('Ty Bar'),
      expected: undefined,
    })

    assert({
      given: 'delete after set',
      should: 'not find by path',
      actual: store.findByPath(filePath),
      expected: undefined,
    })

    assert({
      given: 'delete after set',
      should: 'not find by placePath',
      actual: store.findByPlacePath('places/US/NY/drink/Ty-Bar'),
      expected: undefined,
    })
  } finally {
    await cleanupTestDir()
  }
})
