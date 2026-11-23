import { assert, test } from '#test'
import { estimatedTokens, fitBudget, highestStop, modelTokens, readingCap, STOPS } from './readingBudget.ts'

test({ name: 'readingBudget - the stops are seven, nothing first' }, async () => {
  assert({
    given: 'the stops a fitted budget lands on',
    should: 'run 0 to 750k',
    actual: [...STOPS],
    expected: [0, 25_000, 50_000, 100_000, 300_000, 500_000, 750_000],
  })
})

test(
  { name: "readingBudget - a host's window caps the budget with room for the prompt, tools and reply" },
  async () => {
    assert({
      given:
        'Cerebras serving Qwen 3.8 at 131,072 tokens, a 64k free-tier window, and a profile with no window declared',
      should: 'leave 99,072 of the model’s tokens to read, 32,000 on the small window, and no cap without a window',
      actual: [readingCap(131_072), readingCap(64_000), readingCap(undefined)],
      expected: [99_072, 32_000, null],
    })
  },
)

test({ name: 'readingBudget - a budget the window cannot take drops to the highest stop that fits' }, async () => {
  assert({
    given: 'budgets against the 131,072 window, a window too small for any stop but nothing, and no window',
    should: 'keep what fits, drop 100k and up to 50k, keep nothing, and leave uncapped budgets alone',
    actual: {
      fits: [fitBudget(0, 131_072), fitBudget(25_000, 131_072), fitBudget(50_000, 131_072), fitBudget(99_072, 131_072)],
      drops: [fitBudget(100_000, 131_072), fitBudget(300_000, 131_072), fitBudget(750_000, 131_072)],
      tiny: [fitBudget(25_000, 40_000), highestStop(readingCap(40_000)!)],
      uncapped: [fitBudget(300_000, undefined), fitBudget(750_000, undefined)],
    },
    expected: {
      fits: [0, 25_000, 50_000, 99_072],
      drops: [50_000, 50_000, 50_000],
      tiny: [0, 0],
      uncapped: [300_000, 750_000],
    },
  })
})

test({ name: "readingBudget - budgets count the model's tokens, so a 1M window keeps 750k whole" }, () => {
  assert({
    given: 'a 1M window, and budgets of 750k and 500k',
    should: 'keep both whole',
    actual: [fitBudget(750_000, 1_000_000), fitBudget(500_000, 1_000_000)],
    expected: [750_000, 500_000],
  })
})

test({ name: 'readingBudget - a budget converts to the text it holds and back' }, () => {
  assert({
    given: 'a 750k budget on a model that counts 1.8 tokens per estimated one, and on one that counts 0.823',
    should:
      'hold 416,666 estimated tokens of text on the first and 911,300 on the second, and convert back within a token',
    actual: [
      estimatedTokens(750_000, 1.8),
      modelTokens(estimatedTokens(750_000, 1.8), 1.8),
      estimatedTokens(750_000, 0.823),
    ],
    expected: [416_666, 749_999, 911_300],
  })
})
