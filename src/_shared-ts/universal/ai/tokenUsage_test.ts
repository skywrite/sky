import { assert, test } from '#test'
import { addUsage, formatTokens, NO_USAGE, totalInput, usageLine } from './tokenUsage.ts'

test('formatTokens speaks in thousands the way the strip does', () => {
  assert({
    given: 'counts across four magnitudes',
    should: 'read as plain, one-decimal k, rounded k, and one-decimal M',
    actual: [0, 980, 1000, 4120, 9990, 10_400, 312_000, 1_200_000].map(formatTokens),
    expected: ['0', '980', '1k', '4.1k', '10k', '10k', '312k', '1.2M'],
  })
})

test('a turn sums its calls and reports everything the model read', () => {
  const turn = addUsage(addUsage(NO_USAGE, { input: 110, cacheRead: 0, cacheWrite: 2474, output: 46 }), {
    input: 2,
    cacheRead: 2582,
    cacheWrite: 536,
    output: 46,
  })
  assert({
    given: 'two steps of one turn',
    should: 'add each count, and count cache reads and writes as input read',
    actual: { turn, read: totalInput(turn) },
    expected: { turn: { input: 112, cacheRead: 2582, cacheWrite: 3010, output: 92 }, read: 5704 },
  })
})

test('the usage line names what was read, what came from cache, what came out, and the model', () => {
  assert({
    given: 'a turn over a large cached context',
    should: 'read as the strip does, model last and optional',
    actual: [
      usageLine({ input: 4000, cacheRead: 298_000, cacheWrite: 10_000, output: 4120 }, 'Claude Opus 5'),
      usageLine({ input: 900, cacheRead: 0, cacheWrite: 0, output: 12 }),
    ],
    expected: ['312k in · 298k from cache · 4.1k out · Claude Opus 5', '900 in · 0 from cache · 12 out'],
  })
})
