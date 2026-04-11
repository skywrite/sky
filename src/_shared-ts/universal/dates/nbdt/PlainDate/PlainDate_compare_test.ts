import { assert, test } from '#test'
import PlainDate from './mod.ts'

const comparisonFixtures = [
  {
    a: '2024-01-15',
    b: '2024-01-15',
    expected: 0 as const,
    description: 'same date',
  },
  {
    a: '2024-01-15',
    b: '2024-01-16',
    expected: -1 as const,
    description: 'a is one day before b',
  },
  {
    a: '2024-01-16',
    b: '2024-01-15',
    expected: 1 as const,
    description: 'a is one day after b',
  },
  {
    a: '2024-01-15',
    b: '2024-02-15',
    expected: -1 as const,
    description: 'a is one month before b',
  },
  {
    a: '2024-02-15',
    b: '2024-01-15',
    expected: 1 as const,
    description: 'a is one month after b',
  },
  {
    a: '2023-12-31',
    b: '2024-01-01',
    expected: -1 as const,
    description: 'a is in previous year',
  },
  {
    a: '2024-01-01',
    b: '2023-12-31',
    expected: 1 as const,
    description: 'a is in next year',
  },
  {
    a: '2020-02-29',
    b: '2020-03-01',
    expected: -1 as const,
    description: 'leap year Feb 29 before Mar 1',
  },
]

comparisonFixtures.forEach((fixture) => {
  test(`PlainDate.compare - ${fixture.description}`, () => {
    const a = new PlainDate(fixture.a)
    const b = new PlainDate(fixture.b)

    assert({
      given: `comparing ${fixture.a} to ${fixture.b}`,
      should: `return ${fixture.expected}`,
      actual: PlainDate.compare(a, b),
      expected: fixture.expected,
    })
  })
})

test('PlainDate.compare - works as Array.sort comparator (ascending)', () => {
  const dates = [
    new PlainDate('2024-03-15'),
    new PlainDate('2024-01-01'),
    new PlainDate('2023-12-31'),
    new PlainDate('2024-03-15'),
    new PlainDate('2024-02-28'),
  ]

  const sorted = [...dates].sort(PlainDate.compare)

  assert({
    given: 'an unsorted array of PlainDates',
    should: 'sort them in ascending order',
    actual: sorted.map((d) => d.toString()),
    expected: ['2023-12-31', '2024-01-01', '2024-02-28', '2024-03-15', '2024-03-15'],
  })
})

test('PlainDate.compare - works as Array.sort comparator (descending)', () => {
  const dates = [
    new PlainDate('2024-03-15'),
    new PlainDate('2024-01-01'),
    new PlainDate('2023-12-31'),
    new PlainDate('2024-02-28'),
  ]

  const sorted = [...dates].sort((a, b) => PlainDate.compare(b, a))

  assert({
    given: 'an unsorted array of PlainDates',
    should: 'sort them in descending order when args reversed',
    actual: sorted.map((d) => d.toString()),
    expected: ['2024-03-15', '2024-02-28', '2024-01-01', '2023-12-31'],
  })
})
