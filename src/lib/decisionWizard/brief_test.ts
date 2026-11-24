import { assert, test } from '#test'
import { decisionBrief } from './brief.ts'
import type { WizardSession } from './session.ts'
import { sampleDecidedPlan, sampleDecidingPlan } from './testHelpers.ts'

const run = (fields: Partial<WizardSession>): WizardSession => ({
  id: '00000000-0000-4000-8000-000000000000',
  statement: 'Hire a VP of Sales now, or after the October launch',
  why: null,
  decided: false,
  status: 'ready',
  stage: null,
  since: null,
  read: null,
  error: null,
  plan: sampleDecidingPlan(),
  answers: {},
  step: null,
  adding: null,
  open: null,
  ...fields,
})

test('The brief for a chat says what Sky worked out, what the person answered, and what the wizard still holds back', () => {
  const early = decisionBrief(
    run({ step: 'out:2', answers: { care: 'full', wants: [0, 3], top: 3, options: [2, 3], odds: { 2: 3 } } }),
  )
  assert({
    given: 'a decision part way through the odds, with one option answered',
    should:
      'name it in the person’s words, say where he is, give his odds beside Sky’s, and mark what he has not seen yet',
    actual: [
      early.startsWith('# Hire a VP of Sales now, or after the October launch\n\nYou lead sales yourself'),
      early.includes('He is going through what could happen with each option.'),
      early.includes('## What he wants, the first one first\n\n- Keep Jane Doe, your top account executive ('),
      early.includes('Odds that the first one happens: he said 60–80%. Sky’s: 40–60%. Your notes show'),
      early.includes('Odds that the first one happens: he has not said yet. Sky’s: 40–60% (not shown to him yet).'),
      early.includes('He dropped it from the options to weigh.'),
      early.includes('He has not made the call yet.'),
      early.includes(
        '## Held back in the wizard\n\nThe wizard has him answer before it shows Sky’s answer, so one does not pull the other. He has not yet seen:\n- Sky’s odds for “Promote Jane Doe to lead sales”\n- Sky’s own pick among the options\nDo not volunteer these.',
      ),
    ],
    expected: [true, true, true, true, true, true, true, true],
  })

  const late = decisionBrief(
    run({
      step: 'rules',
      answers: {
        frame: 1,
        care: 'full',
        wants: [0, 3],
        top: 3,
        options: [2, 3],
        odds: { 2: 3, 3: 4 },
        oddsUse: { 3: 'middle' },
        oddsNote: { 3: 'She asked me about the role in May.' },
        hinge: 'now',
        call: 3,
        final: 'keep',
        wrong: { 3: ['You kept the big deals yourself.'] },
      },
    }),
  )
  assert({
    given: 'the same decision after the call',
    should: 'take the wording he chose, give his call and what worries him, and hold nothing back',
    actual: [
      late.startsWith('# Who leads sales through the October launch\n'),
      late.includes('he said Over 80%, and settled on 60–80%. Sky’s: 40–60%.'),
      late.includes('What he told Sky it was missing: She asked me about the role in May.'),
      late.includes('THIS IS HIS CALL.'),
      late.includes('His call: Promote Jane Doe to lead sales (he kept it after seeing Sky’s view).'),
      late.includes('What worries him about it:\n- You kept the big deals yourself.'),
      late.includes('Sky would choose “Bring in a part-time sales lead for six months”.'),
      late.includes('Held back'),
    ],
    expected: [true, true, true, true, true, true, true, false],
  })
})

test('The brief for a decision already made gives what the notebook showed and what he has answered', () => {
  const brief = decisionBrief(
    run({
      statement: 'No senior hires before the Series B closes',
      decided: true,
      plan: sampleDecidedPlan(),
      step: 'force',
      answers: {
        wording: 'No senior hires before the Series B closes',
        when: '2030-03-12',
        knew: ['Burn was $520k a month against a plan of $450k.'],
        wants: ['Get burn back under $450k a month'],
        others: [],
      },
    }),
  )
  assert({
    given: 'a made decision being written down, at the step about whether it still binds',
    should: 'say it was already made, split what was known from what was learned since, and list his answers so far',
    actual: [
      brief.includes('This decision was already made, and he is writing it down. He is saying whether it still binds.'),
      brief.includes(
        '## What he knew that day\n\n- Burn was $520k a month against a plan of $450k. (Finance review, Mar 8)',
      ),
      brief.includes(
        '## Learned since, and kept out of the reasons\n\n- The round slipped from July to the third quarter.',
      ),
      brief.includes('Counted as known that day:\n- Burn was $520k a month against a plan of $450k.'),
      brief.includes('Wanted:\n- Get burn back under $450k a month'),
      decisionBrief(run({ plan: null, status: 'thinking' })),
    ],
    expected: [true, true, true, true, true, ''],
  })
})
