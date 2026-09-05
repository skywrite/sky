import { assert, test } from '#test'
import { fitBudget, highestStop, reachIndex, readingCap, STOPS, stopIndex } from './readingBudget.ts'

test({ name: 'readingBudget - the stops are seven, nothing first, and a budget sits at the nearest one' }, async () => {
  assert({
    given: 'the stops, and budgets on, between and beyond them',
    should: 'run 0 to 750k and place each budget at its nearest stop',
    actual: {
      stops: [...STOPS],
      onAStop: stopIndex(300_000),
      between: [stopIndex(60_000), stopIndex(79_257), stopIndex(250_000)],
      beyond: stopIndex(2_000_000),
      nothing: stopIndex(0),
    },
    expected: {
      stops: [0, 25_000, 50_000, 100_000, 300_000, 500_000, 750_000],
      onAStop: 4,
      between: [2, 3, 4],
      beyond: 6,
      nothing: 0,
    },
  })
})

test(
  { name: "readingBudget - a host's window caps the budget with room for the prompt, tools, reply and slack" },
  async () => {
    assert({
      given:
        'Cerebras serving Qwen 3.8 at 131,072 tokens, a 64k free-tier window, and a profile with no window declared',
      should: 'leave 79,257 to read, 25,600 on the small window, and no cap without a window',
      actual: [readingCap(131_072), readingCap(64_000), readingCap(undefined)],
      expected: [79_257, 25_600, null],
    })
  },
)

test({ name: 'readingBudget - a budget the window cannot take drops to the highest stop that fits' }, async () => {
  assert({
    given: 'budgets against the 131,072 window, a window too small for any stop but nothing, and no window',
    should: 'keep what fits, drop 100k and 300k to 50k, keep nothing, and leave uncapped budgets alone',
    actual: {
      fits: [fitBudget(0, 131_072), fitBudget(25_000, 131_072), fitBudget(50_000, 131_072), fitBudget(79_257, 131_072)],
      drops: [fitBudget(100_000, 131_072), fitBudget(300_000, 131_072), fitBudget(750_000, 131_072)],
      tiny: [fitBudget(25_000, 40_000), highestStop(readingCap(40_000)!)],
      uncapped: [fitBudget(300_000, undefined), fitBudget(750_000, undefined)],
      reach: [reachIndex(131_072), reachIndex(40_000), reachIndex(undefined)],
    },
    expected: {
      fits: [0, 25_000, 50_000, 79_257],
      drops: [50_000, 50_000, 50_000],
      tiny: [0, 0],
      uncapped: [300_000, 750_000],
      reach: [2, 0, 6],
    },
  })
})
