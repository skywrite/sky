import { assert, test } from '#test'
import mapLimit from './mapLimit.ts'

test('mapLimit preserves order', async () => {
  const items = [30, 10, 20]
  const results = await mapLimit(items, 2, async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return ms
  })
  assert({ given: 'staggered completion times', should: 'keep input order', actual: results, expected: [30, 10, 20] })
})

test('mapLimit bounds concurrency', async () => {
  let running = 0
  let peak = 0
  await mapLimit([1, 2, 3, 4, 5, 6], 2, async () => {
    running++
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    running--
  })
  assert({ given: 'limit 2 over six items', should: 'never exceed the limit', actual: peak <= 2, expected: true })
})
