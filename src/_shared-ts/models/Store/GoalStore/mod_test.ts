import { mkdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { writeTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import GoalStore from './mod.ts'

const TEST_DIR = '/tmp/goal-store-test'

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

test('GoalStore.empty: creates empty store', () => {
  const store = GoalStore.empty()

  assert({
    given: 'empty store',
    should: 'have size 0',
    actual: store.size,
    expected: 0,
  })

  assert({
    given: 'empty store',
    should: 'have no goals',
    actual: store.hasGoals,
    expected: false,
  })
})

test('GoalStore.build: loads personal.md', async () => {
  await setupTestDir()

  try {
    const contents = [
      '---',
      'category: Personal',
      '---',
      '',
      '# Personal Goals',
      '',
      '## Health',
      '',
      '### Outcome',
      'Run a marathon',
      '',
      '### Current State',
      'Can run 5k',
      '',
      '### Why It Matters',
      'Physical fitness',
    ].join('\n')

    await writeTextFile(path.join(TEST_DIR, 'personal.md'), contents)

    const store = await GoalStore.build(TEST_DIR)

    assert({
      given: 'store with personal.md',
      should: 'have size 1',
      actual: store.size,
      expected: 1,
    })

    assert({
      given: 'store with personal.md',
      should: 'return personal goals',
      actual: store.getPersonal()?.category,
      expected: 'Personal',
    })

    assert({
      given: 'store with only personal.md',
      should: 'return undefined for professional',
      actual: store.getProfessional(),
      expected: undefined,
    })
  } finally {
    await cleanupTestDir()
  }
})

test('GoalStore.build: loads both personal and professional', async () => {
  await setupTestDir()

  try {
    const personal = '---\ncategory: Personal\n---\n\n# Personal Goals'
    const professional = '---\ncategory: Professional\n---\n\n# Professional Goals'

    await writeTextFile(path.join(TEST_DIR, 'personal.md'), personal)
    await writeTextFile(path.join(TEST_DIR, 'professional.md'), professional)

    const store = await GoalStore.build(TEST_DIR)

    assert({
      given: 'store with both files',
      should: 'have size 2',
      actual: store.size,
      expected: 2,
    })

    assert({
      given: 'getByCategory Personal',
      should: 'return personal goals',
      actual: store.getByCategory('Personal')?.category,
      expected: 'Personal',
    })

    assert({
      given: 'getByCategory Professional',
      should: 'return professional goals',
      actual: store.getByCategory('Professional')?.category,
      expected: 'Professional',
    })

    assert({
      given: 'getPath Personal',
      should: 'return correct path',
      actual: store.getPath('Personal'),
      expected: path.join(TEST_DIR, 'personal.md'),
    })
  } finally {
    await cleanupTestDir()
  }
})

test('GoalStore.findByPath: returns document by path', async () => {
  await setupTestDir()

  try {
    const contents = '---\ncategory: Personal\n---\n\n# Personal Goals'
    const filePath = path.join(TEST_DIR, 'personal.md')
    await writeTextFile(filePath, contents)

    const store = await GoalStore.build(TEST_DIR)

    assert({
      given: 'findByPath with valid path',
      should: 'return the document',
      actual: store.findByPath(filePath)?.category,
      expected: 'Personal',
    })

    assert({
      given: 'findByPath with unknown path',
      should: 'return undefined',
      actual: store.findByPath('/some/other/path.md'),
      expected: undefined,
    })
  } finally {
    await cleanupTestDir()
  }
})

test('GoalStore.getAll: returns collection', async () => {
  await setupTestDir()

  try {
    await writeTextFile(path.join(TEST_DIR, 'personal.md'), '---\ncategory: Personal\n---\n\n# Goals')

    const store = await GoalStore.build(TEST_DIR)

    assert({
      given: 'getAll',
      should: 'return collection with correct size',
      actual: store.getAll().size,
      expected: 1,
    })
  } finally {
    await cleanupTestDir()
  }
})

test('GoalStore.build: one goal per file, active and ended, beside an older category file', async () => {
  await setupTestDir()

  try {
    await mkdir(path.join(TEST_DIR, 'active'), { recursive: true })
    await mkdir(path.join(TEST_DIR, 'reached', '2025'), { recursive: true })
    await writeTextFile(
      path.join(TEST_DIR, 'active', 'Launch-Atlas.md'),
      '---\ntitle: Launch Atlas\ncategory: Professional\n---\n\nThree pilot teams by June.',
    )
    await writeTextFile(path.join(TEST_DIR, 'active', 'Run-A-Marathon.md'), '# Run a marathon\n\nFinish one this year.')
    await writeTextFile(path.join(TEST_DIR, 'reached', '2025', 'Learn-Spanish.md'), '# Learn Spanish')
    await writeTextFile(
      path.join(TEST_DIR, 'personal.md'),
      '---\ncategory: Personal\n---\n\n## Health\n\n**Outcome:** Sleep eight hours\n**Current State:** Six\n**Why It Matters:** Energy',
    )

    const store = await GoalStore.build(TEST_DIR)

    assert({
      given: 'two active goals, one reached, and an older personal.md',
      should: 'load all four and split them by folder',
      actual: [store.size, store.getActive().size, store.getEnded().size],
      expected: [4, 3, 1],
    })

    assert({
      given: 'a goal with a title field and one with only a heading',
      should: 'name each by its file and title it from the field or the heading',
      actual: [store.find('Launch-Atlas')?.value.title, store.find('run-a-marathon')?.value.title, store.names.sort()],
      expected: ['Launch Atlas', 'Run a marathon', ['launch-atlas', 'learn-spanish', 'personal', 'run-a-marathon']],
    })

    assert({
      given: 'the active goals',
      should: 'give one line per goal: titles for one-goal files, the areas inside an older file',
      actual: store.activeGoalLines(),
      expected: ['Launch Atlas', 'Run a marathon', 'Health: Sleep eight hours'],
    })

    assert({
      given: 'an older notebook file beside the new ones',
      should: 'still be reachable by category',
      actual: [store.getPersonal()?.category, store.getPath('Personal'), store.getProfessional()],
      expected: ['Personal', path.join(TEST_DIR, 'personal.md'), undefined],
    })
  } finally {
    await cleanupTestDir()
  }
})
