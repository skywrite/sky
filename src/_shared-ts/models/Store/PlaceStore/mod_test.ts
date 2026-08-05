import { mkdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { writeTextFile } from '#shared/fs/mod.ts'
import PlaceDocument from '#shared/models/Place/mod.ts'
import { assert, test } from '#test'
import PlaceStore from './mod.ts'

const TEST_DIR = '/tmp/place-store-test'

async function setupTestDir() {
  // Clean up if exists
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

test('PlaceStore.empty: creates empty store', () => {
  const store = PlaceStore.empty()

  assert({
    given: 'empty store',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })
})

test('PlaceStore.build: indexes places by name and path', async () => {
  await setupTestDir()

  try {
    // Create test place files
    const usDir = path.join(TEST_DIR, 'US/NY/New-York/drink')
    await mkdir(usDir, { recursive: true })

    const placeDoc = PlaceDocument.create({
      name: 'Ty Bar',
      type: 'drink',
      address: '2 E 55th St, New York, NY',
      location: {
        country: 'US',
        region: 'NY',
        city: 'New York',
        subcity: 'Manhattan',
        latitude: 40.7614,
        longitude: -73.9747,
      },
    })

    const placePath = path.join(usDir, 'Ty-Bar.md')
    await writeTextFile(placePath, placeDoc.toMarkdown())

    // Build store
    const store = await PlaceStore.build(TEST_DIR)

    assert({
      given: 'store with one place',
      should: 'have size 1',
      actual: store.size,
      expected: 1,
    })

    // Find by name
    const byName = store.find('Ty Bar')
    assert({
      given: 'find by name',
      should: 'return the place',
      actual: byName?.value.name,
      expected: 'Ty Bar',
    })

    // Find by path
    const byPath = store.findByPath(placePath)
    assert({
      given: 'find by file path',
      should: 'return the place',
      actual: byPath?.name,
      expected: 'Ty Bar',
    })

    // Find by place path
    const byPlacePath = store.findByPlacePath('places/US/NY/New-York/drink/Ty-Bar')
    assert({
      given: 'find by place path',
      should: 'return the place',
      actual: byPlacePath?.value.name,
      expected: 'Ty Bar',
    })
  } finally {
    await cleanupTestDir()
  }
})

test('PlaceStore.build: handles multiple places', async () => {
  await setupTestDir()

  try {
    // Create two places in different locations
    const usDir = path.join(TEST_DIR, 'US/NY/New-York/drink')
    const plDir = path.join(TEST_DIR, 'PL/Krakow/eat')
    await mkdir(usDir, { recursive: true })
    await mkdir(plDir, { recursive: true })

    const place1 = PlaceDocument.create({
      name: 'Ty Bar',
      type: 'drink',
      location: { country: 'US', region: 'NY', city: 'New York', latitude: 40.7614, longitude: -73.9747 },
    })
    const place2 = PlaceDocument.create({
      name: 'Trattoria',
      type: 'eat',
      location: { country: 'PL', city: 'Krakow', latitude: 50.0647, longitude: 19.945 },
    })

    await writeTextFile(path.join(usDir, 'Ty-Bar.md'), place1.toMarkdown())
    await writeTextFile(path.join(plDir, 'Trattoria.md'), place2.toMarkdown())

    const store = await PlaceStore.build(TEST_DIR)

    assert({
      given: 'store with two places',
      should: 'have size 2',
      actual: store.size,
      expected: 2,
    })

    assert({
      given: 'find first place',
      should: 'return correct name',
      actual: store.find('Ty Bar')?.value.name,
      expected: 'Ty Bar',
    })

    assert({
      given: 'find second place',
      should: 'return correct name',
      actual: store.find('Trattoria')?.value.name,
      expected: 'Trattoria',
    })
  } finally {
    await cleanupTestDir()
  }
})

test('PlaceStore.getAll: returns collection', async () => {
  await setupTestDir()

  try {
    const dir = path.join(TEST_DIR, 'US/NY/New-York/drink')
    await mkdir(dir, { recursive: true })

    const place = PlaceDocument.create({
      name: 'Test Place',
      type: 'drink',
      location: { country: 'US', latitude: 40.7, longitude: -74.0 },
    })
    await writeTextFile(path.join(dir, 'Test-Place.md'), place.toMarkdown())

    const store = await PlaceStore.build(TEST_DIR)
    const collection = store.getAll()

    assert({
      given: 'getAll',
      should: 'return collection with correct size',
      actual: collection.size,
      expected: 1,
    })
  } finally {
    await cleanupTestDir()
  }
})
