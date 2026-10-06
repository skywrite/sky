import { assert, test } from '#test'
import { keptOwnerAddresses } from './ownerAddresses.ts'

test('keptOwnerAddresses', async () => {
  let clock = 0
  let asks = 0
  const answers: Array<() => Promise<string[]>> = [
    async () => ['jane@example.com'],
    async () => {
      throw new Error('offline')
    },
    async () => ['jane@example.com', 'jane@example.org'],
  ]
  const owner = keptOwnerAddresses(() => answers[asks++](), { reloadMs: 1_000, now: () => clock })

  const first = await owner()
  const reused = await owner()
  clock = 1_000
  const failed = await owner()
  clock = 2_000
  const later = await owner()
  assert({
    given: 'a first ask, a refresh inside the reuse window, a failed ask once it passes, and a later one',
    should: 'wait for the first answer, reuse it, keep it through the failure, then take the new answer',
    expected: {
      first: ['jane@example.com'],
      reused: ['jane@example.com'],
      failed: ['jane@example.com'],
      later: ['jane@example.com', 'jane@example.org'],
      asks: 3,
    },
    actual: { first, reused, failed, later, asks },
  })
})

test('keptOwnerAddresses does not hold a refresh on a slow answer', async () => {
  let answer: (addresses: string[]) => void = () => {}
  const owner = keptOwnerAddresses(() => new Promise((resolve) => (answer = resolve)), { waitMs: 5 })

  const meanwhile = await owner()
  answer(['jane@example.com'])
  const after = await owner()
  assert({
    given: 'an answer that has not come back within the wait, then has',
    should: 'answer with nothing known meanwhile, and with the answer after',
    expected: { meanwhile: [], after: ['jane@example.com'] },
    actual: { meanwhile, after },
  })
})
