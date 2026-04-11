import { assert, test } from '#test'
import Duration from './mod.ts'

test('Duration.from object', () => {
  const d = Duration.from({ hours: 2, minutes: 15 })
  assert({ given: '{ hours: 2, minutes: 15 }', should: 'create Duration', actual: d.total('minutes'), expected: 135 })
})

test('Duration.from Duration instance', () => {
  const original = new Duration(1, 30, 0)
  const copy = Duration.from(original)
  assert({ given: 'Duration instance', should: 'copy', actual: copy.total('minutes'), expected: 90 })
})

const parseFixtures = [
  { given: '"PT1H"', input: 'PT1H', hours: 1, minutes: 0, seconds: 0 },
  { given: '"PT30M"', input: 'PT30M', hours: 0, minutes: 30, seconds: 0 },
  { given: '"PT1H30M"', input: 'PT1H30M', hours: 1, minutes: 30, seconds: 0 },
  { given: '"PT90S"', input: 'PT90S', hours: 0, minutes: 0, seconds: 90 },
  { given: '"PT1H30M15S"', input: 'PT1H30M15S', hours: 1, minutes: 30, seconds: 15 },
  { given: '"-PT1H"', input: '-PT1H', hours: -1, minutes: 0, seconds: 0 },
  { given: 'lowercase "pt2h"', input: 'pt2h', hours: 2, minutes: 0, seconds: 0 },
]

parseFixtures.forEach(({ given, input, hours, minutes, seconds }) => {
  test(`Duration.from ISO string - ${given}`, () => {
    const d = Duration.from(input)
    assert({ given, should: 'parse hours', actual: d.hours, expected: hours })
    assert({ given, should: 'parse minutes', actual: d.minutes, expected: minutes })
    assert({ given, should: 'parse seconds', actual: d.seconds, expected: seconds })
  })
})

test('Duration.from ISO string - rejects bare "PT"', () => {
  let threw = false
  try {
    Duration.from('PT')
  } catch {
    threw = true
  }
  assert({ given: '"PT"', should: 'throw', actual: threw, expected: true })
})

test('Duration.from ISO string - rejects garbage', () => {
  let threw = false
  try {
    Duration.from('nope')
  } catch {
    threw = true
  }
  assert({ given: '"nope"', should: 'throw', actual: threw, expected: true })
})
