import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import StreakDocument from '#shared/models/Streak/mod.ts'
import { assert, test } from '#test'
import { createStreakClassifier, resolveStreakCategory, type StreakCategoryEvidence } from './category.ts'

test('streak categories prefer explicit and saved choices, and do not retain a failed guess', async () => {
  const streak = StreakDocument.create({ name: 'read', category: 'Professional' })
  let calls = 0
  const unavailable = async () => {
    calls++
    throw new Error('Mock model unavailable')
  }
  assert({
    given: 'a saved category and an explicit correction',
    should: 'honor both without depending on the model',
    actual: [
      await resolveStreakCategory(streak, undefined, unavailable),
      await resolveStreakCategory(streak, 'Personal', unavailable),
      calls,
    ],
    expected: [{ category: 'Professional' }, { category: 'Personal' }, 0],
  })
  const result = await resolveStreakCategory(StreakDocument.create({ name: 'read' }), undefined, unavailable)
  assert({
    given: 'an uncategorized streak when inference fails',
    should: 'leave the category unset and explain that a choice is needed',
    actual: [result.category, Boolean(result.warning), calls],
    expected: [undefined, true, 1],
  })
})

test('streak classification reads the purpose and only supplies linked project and goal context', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-streak-category-'))
  try {
    const projectDir = path.join(root, 'projects/open/Atlas/_project')
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      path.join(projectDir, 'overview.md'),
      '---\nname: Atlas\n---\n\n# Atlas\n\nBuild the customer support product.\n',
    )
    await mkdir(path.join(root, 'goals'))
    await writeFile(
      path.join(root, 'goals/professional.md'),
      '---\ncategory: Professional\n---\n\n# Professional Goals\n\nImprove customer retention.\n',
    )
    await writeFile(
      path.join(root, 'goals/personal.md'),
      '---\ncategory: Personal\n---\n\n# Personal Goals\n\nLearn to swim.\n',
    )
    const streak = StreakDocument.create({
      name: 'read',
      title: 'Read a chapter',
      why: 'Learn how to improve customer support.',
      details: 'Read one chapter about running a support team.',
      rel: ['projects/Atlas', 'goals/professional'],
      tags: 'Learning',
    })
    let evidence: StreakCategoryEvidence | undefined
    const classify = createStreakClassifier(root, async (input) => {
      evidence = input
      return 'Professional'
    })
    const category = await classify(streak)
    assert({
      given: 'an ambiguous reading habit with a work purpose and linked records',
      should: 'provide its full intent and linked evidence, excluding unrelated goals',
      actual: [
        category,
        evidence?.definition.includes('Learn how to improve customer support.'),
        evidence?.definition.includes('running a support team'),
        evidence?.related.map((entry) => entry.reference),
        evidence?.related.some((entry) => entry.content.includes('customer retention')),
        evidence?.related.some((entry) => entry.content.includes('support product')),
        JSON.stringify(evidence).includes('Learn to swim'),
      ],
      expected: ['Professional', true, true, ['projects/Atlas', 'goals/professional'], true, true, false],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
