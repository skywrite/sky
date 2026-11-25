import { sampleDecidingPlan } from '#lib/decisionWizard/testHelpers.ts'
import { assert, test } from '#test'
import { effectOf, weighed, weighingSummary } from './tally.ts'

test('the weighing: Sky’s read with its reason, the person’s change without one, and what Sky says under it', () => {
  const plan = sampleDecidingPlan()
  assert({
    given: 'a cell Sky gave a reason for, the same cell after the person changed it, and a plan with no reasons',
    should: 'give Sky’s read with its reason, the person’s read without one, and no reason where none was kept',
    actual: [
      effectOf(plan, {}, 0, 2),
      effectOf(plan, { effects: { '0.2': 'costs' } }, 0, 2),
      effectOf(plan, { effects: { '0.2': 'helps' } }, 0, 2),
      effectOf(plan, {}, 1, 0),
    ],
    expected: [
      { effect: 'helps', why: 'A contractor takes the weekly pipeline off you.' },
      { effect: 'costs', why: '' },
      { effect: 'helps', why: 'A contractor takes the weekly pipeline off you.' },
      { effect: 'helps', why: '' },
    ],
  })
  assert({
    given: 'nothing chosen yet, then two wants with one put first and two options kept',
    should: 'show every option against every want Sky found, then only what was kept, the first want first',
    actual: [weighed(plan, {}), weighed(plan, { wants: [0, 3], top: 3, options: [2, 3] })],
    expected: [
      { options: [0, 1, 2, 3], wants: [0, 1, 2, 3] },
      { options: [2, 3], wants: [3, 0] },
    ],
  })
  assert({
    given: 'one option ahead, then two options level, then the call made against Sky’s pick and with it',
    should:
      'name the option that serves the most, say a tie as a tie, say which two Sky finds close, and give Sky’s own pick only once the person has seen it',
    actual: [
      weighingSummary(plan, {}),
      weighingSummary(plan, { wants: [0, 1], options: [2, 3] }),
      weighingSummary(plan, { wants: [0, 1], options: [0, 1] }),
      weighingSummary(plan, { wants: [0, 3], options: [2, 3], call: 3 }).some((line) => line.startsWith('Sky would')),
      weighingSummary(plan, { wants: [0, 3], options: [2, 3], call: 3, final: 'keep' }).at(-1),
      weighingSummary(plan, { wants: [0, 3], options: [2, 3], call: 2, final: 'keep' }).at(-1),
    ],
    expected: [
      [
        '“Promote Jane” helps three of the four things you want, more than any other option.',
        'Sky’s read is that “Part-time lead” and “Promote Jane” come out close, so you cannot be far wrong between them.',
      ],
      [
        '“Part-time lead” and “Promote Jane” each help all two things you want.',
        'Sky’s read is that “Part-time lead” and “Promote Jane” come out close, so you cannot be far wrong between them.',
      ],
      ['“Hire a VP now” helps one of the two things you want and costs one, more than any other option.'],
      // The call is picked, and Sky's view of it has not been shown yet.
      false,
      'Sky would choose “Part-time lead”.',
      'Sky would make the same call.',
    ],
  })
})
