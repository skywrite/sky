import { assert, test } from '#test'
import {
  budgetFromEstimate,
  estimatedTokens,
  fitBudget,
  highestStop,
  modelTokens,
  reachIndex,
  readingCap,
  STOPS,
  stopIndex,
} from './readingBudget.ts'

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
      reach: [reachIndex(131_072), reachIndex(40_000), reachIndex(undefined)],
    },
    expected: {
      fits: [0, 25_000, 50_000, 99_072],
      drops: [50_000, 50_000, 50_000],
      tiny: [0, 0],
      uncapped: [300_000, 750_000],
      reach: [2, 0, 6],
    },
  })
})

test({ name: "readingBudget - the slider counts the model's tokens, so a 1M window reaches 750k" }, () => {
  assert({
    given: 'the 1M windows of Opus 5.5 and Fable 5.1, and GPT-6.1 Sol’s 1.05M',
    should: 'reach the last stop and keep a 750k budget whole',
    actual: [
      STOPS[reachIndex(1_000_000)],
      STOPS[reachIndex(1_050_000)],
      fitBudget(750_000, 1_000_000),
      fitBudget(500_000, 1_000_000),
    ],
    expected: [750_000, 750_000, 750_000, 500_000],
  })
})

test({ name: 'readingBudget - a budget converts to the text it holds and back' }, () => {
  assert({
    given: 'a 750k budget on a model that counts 1.8 tokens per estimated one, and on one that counts 0.823',
    should:
      'hold 416,666 estimated tokens of text on the first and 911,300 on the second, and convert back to the budget',
    actual: [
      estimatedTokens(750_000, 1.8),
      modelTokens(estimatedTokens(750_000, 1.8), 1.8),
      estimatedTokens(750_000, 0.823),
      budgetFromEstimate(estimatedTokens(750_000, 1.8), 1.8),
      budgetFromEstimate(estimatedTokens(500_000, 0.823), 0.823),
    ],
    expected: [416_666, 749_999, 911_300, 750_000, 500_000],
  })
})

test(
  { name: 'readingBudget - a saved budget keeps its size in the model’s tokens, and lands on a stop it drifted from' },
  () => {
    assert({
      given:
        'budgets of 300k and 500k saved when the slider counted estimates, on a model at 1.78; a 750k budget saved at 1.8 and read back at 1.75; a small budget; a closed notebook',
      should:
        'keep what the old budgets read, return the drifted one as 750k, keep the small one, and nothing as nothing',
      actual: [
        budgetFromEstimate(300_000, 1.78),
        budgetFromEstimate(500_000, 1.78),
        budgetFromEstimate(estimatedTokens(750_000, 1.8), 1.75),
        budgetFromEstimate(5_000, 1.5),
        budgetFromEstimate(0, 1.78),
      ],
      expected: [534_000, 890_000, 750_000, 7_500, 0],
    })
  },
)
