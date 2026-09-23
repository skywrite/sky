import { assert, test } from '#test'
import { EFFORTS, effortLevels, validateEffort } from './effort.ts'

// Opus 5.5 joined the catalog on 2026-09-22; an unlisted model advertises
// only its preset's own level, which made `--ai-effort low` fail on it.
test('effort levels for Opus 5.5', () => {
  const profile = {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    options: { effort: 'xhigh', thinking: { type: 'adaptive' } },
  }
  assert({
    given: 'the Opus 5.5 model',
    should: 'advertise every effort level, as Opus 5 did',
    actual: effortLevels(profile),
    expected: EFFORTS,
  })
  let rejected: string | undefined
  try {
    validateEffort(profile, 'low')
  } catch (error) {
    rejected = (error as Error).message
  }
  assert({
    given: 'a low override on that model',
    should: 'validate',
    actual: rejected,
    expected: undefined,
  })
})
