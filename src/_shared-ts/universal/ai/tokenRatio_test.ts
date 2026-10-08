import { assert, test } from '#test'
import { DEFAULT_RATIO, observeRatio, seedRatio } from './tokenRatio.ts'

test({ name: 'tokenRatio - seeds by model family, default for the unknown' }, () => {
  assert({
    given: 'the registry model ids',
    should:
      'seed the Opus 4.7 tokenizer family high (Haiku 5.5 with it), Haiku 4.5 and GPT-6 lower, and an unknown model at the old slack',
    actual: [
      'claude-opus-5-5',
      'claude-fable-5-1',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-haiku-4-5',
      'gpt-6-astra',
      'qwen-3.8-27b',
    ].map(seedRatio),
    expected: [1.75, 1.75, 1.75, 1.75, 1.25, 1.15, DEFAULT_RATIO],
  })
})

test({ name: 'tokenRatio - the first observation replaces the seed, later ones move it a fifth of the way' }, () => {
  const first = observeRatio(undefined, 100_000, 178_000, 't1')
  const second = observeRatio(first, 50_000, 95_000, 't2')
  assert({
    given: 'a 1.78 observation then a 1.90 one',
    should: 'take 1.78 outright, then move to 1.804 with two samples',
    actual: [first, second],
    expected: [
      { ratio: 1.78, samples: 1, updated: 't1' },
      { ratio: 1.804, samples: 2, updated: 't2' },
    ],
  })
})

test({ name: 'tokenRatio - small requests and absurd counts are not samples' }, () => {
  const kept = { ratio: 1.7, samples: 3, updated: 't0' }
  assert({
    given: 'a 2k-token request, a zero count, and a count ten times the estimate',
    should: 'leave the record untouched each time',
    actual: [
      observeRatio(kept, 2_000, 9_000, 't1'),
      observeRatio(kept, 50_000, 0, 't1'),
      observeRatio(kept, 50_000, 500_000, 't1'),
    ],
    expected: [kept, kept, kept],
  })
})
