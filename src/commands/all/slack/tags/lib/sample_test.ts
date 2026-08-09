import { assert, test } from '#test'
import { mulberry32, seededShuffle, stratifiedSample } from './sample.ts'

test('mulberry32 is deterministic', () => {
  const a = mulberry32(42)
  const b = mulberry32(42)
  assert({
    given: 'the same seed',
    should: 'produce the same sequence',
    actual: [a(), a(), a()],
    expected: [b(), b(), b()],
  })
})

test('seededShuffle reproduces and preserves membership', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8]
  const first = seededShuffle(items, mulberry32(7))
  const second = seededShuffle(items, mulberry32(7))
  assert({ given: 'the same seed', should: 'produce the same order', actual: first, expected: second })
  assert({ given: 'a shuffle', should: 'keep all items', actual: [...first].sort(), expected: items })
})

test('stratifiedSample returns everything when n covers the pool', () => {
  const items = ['a', 'b', 'c']
  const picked = stratifiedSample(items, (s) => s, 10, mulberry32(1))
  assert({ given: 'n larger than pool', should: 'return the whole pool', actual: picked.length, expected: 3 })
})

test('stratifiedSample is roughly proportional by group', () => {
  const items = [
    ...Array.from({ length: 80 }, (_, i) => ({ month: '01', i })),
    ...Array.from({ length: 20 }, (_, i) => ({ month: '02', i })),
  ]
  const picked = stratifiedSample(items, (r) => r.month, 20, mulberry32(3))
  const feb = picked.filter((r) => r.month === '02').length
  assert({
    given: 'a 80/20 pool sampled to 20',
    should: 'give the minority group a small share',
    actual: feb >= 1 && feb <= 8,
    expected: true,
  })
  assert({ given: 'a requested size', should: 'be honored', actual: picked.length, expected: 20 })
})
