import { assert, test } from '#test'
import MostImportant from './mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const fixtures = [
  {
    description: 'specific date',
    date: new PlainDate(2025, 10, 1),
    summary: 'Test Summary',
    expectedYmd: '2025-10-01',
  },
  {
    description: 'first day of year',
    date: new PlainDate(2025, 1, 1),
    summary: 'New Year Task',
    expectedYmd: '2025-01-01',
  },
  {
    description: 'last day of year',
    date: new PlainDate(2025, 12, 31),
    summary: 'Year End Task',
    expectedYmd: '2025-12-31',
  },
  {
    description: 'leap day',
    date: new PlainDate(2024, 2, 29),
    summary: 'Leap Day Task',
    expectedYmd: '2024-02-29',
  },
]

fixtures.forEach((fixture) => {
  test(`MostImportant constructor - ${fixture.description}`, () => {
    const mi = new MostImportant(fixture.date, fixture.summary)

    assert({
      given: fixture.description,
      should: 'store PlainDate',
      actual: mi.date instanceof PlainDate,
      expected: true,
    })

    assert({
      given: fixture.description,
      should: `have YMD ${fixture.expectedYmd}`,
      actual: mi.YMD,
      expected: fixture.expectedYmd,
    })

    assert({
      given: fixture.description,
      should: 'store summary',
      actual: mi.summary,
      expected: fixture.summary,
    })
  })
})

test('MostImportant constructor with no arguments', () => {
  const mi = new MostImportant()

  assert({
    given: 'no arguments',
    should: 'use today as default date',
    actual: mi.date instanceof PlainDate,
    expected: true,
  })

  assert({
    given: 'no arguments',
    should: 'have empty summary',
    actual: mi.summary,
    expected: '',
  })
})

test('MostImportant.create() with default options', () => {
  const date = new PlainDate(2025, 10, 1)
  const mi = MostImportant.create(date)

  assert({
    given: 'create with default options',
    should: 'have correct date',
    actual: mi.YMD,
    expected: '2025-10-01',
  })

  assert({
    given: 'create with default options',
    should: 'have empty summary',
    actual: mi.summary,
    expected: '',
  })
})

test('MostImportant.create() with summary option', () => {
  const date = new PlainDate(2025, 10, 1)
  const mi = MostImportant.create(date, { summary: 'Important Task' })

  assert({
    given: 'create with summary option',
    should: 'have correct summary',
    actual: mi.summary,
    expected: 'Important Task',
  })
})

test('MostImportant.create() with count option', () => {
  const date = new PlainDate(2025, 10, 1)
  const mi = MostImportant.create(date, { count: 5 })

  assert({
    given: 'create with count option',
    should: 'generate markdown with questions',
    actual: mi.toMarkdown().includes('##'),
    expected: true,
  })
})

test('MostImportant.create() with dependQuestions option', () => {
  const date = new PlainDate(2025, 10, 1)
  const mi = MostImportant.create(date, { dependQuestions: true })

  const markdown = mi.toMarkdown()

  assert({
    given: 'create with dependQuestions option',
    should: 'include depend questions in markdown',
    actual: markdown.length > 100,
    expected: true,
  })
})

test('MostImportant.toMarkdown() produces valid markdown', () => {
  const date = new PlainDate(2025, 10, 1)
  const mi = MostImportant.create(date, { summary: 'Test', count: 1 })
  const markdown = mi.toMarkdown()

  assert({
    given: 'MostImportant instance',
    should: 'produce markdown with YAML frontmatter',
    actual: markdown.startsWith('---'),
    expected: true,
  })

  assert({
    given: 'MostImportant instance',
    should: 'include date in markdown',
    actual: markdown.includes('2025-10-01'),
    expected: true,
  })
})

test('MostImportant.dayWordShort returns day name', () => {
  const date = new PlainDate(2025, 10, 1) // Wednesday
  const mi = new MostImportant(date)

  assert({
    given: 'October 1, 2025 (Wednesday)',
    should: 'return Wed',
    actual: mi.dayWordShort,
    expected: 'Wed',
  })
})

test('MostImportant.toString() returns formatted string', () => {
  const date = new PlainDate(2025, 10, 1)
  const mi = new MostImportant(date)

  assert({
    given: 'MostImportant instance',
    should: 'return string with YMD',
    actual: mi.toString(),
    expected: 'MostImportant<2025-10-01>',
  })
})

test('MostImportant Symbol.toStringTag', () => {
  const date = new PlainDate(2025, 10, 1)
  const mi = new MostImportant(date)

  assert({
    given: 'MostImportant instance',
    should: 'have correct toStringTag',
    actual: Object.prototype.toString.call(mi),
    expected: '[object MostImportant]',
  })
})
