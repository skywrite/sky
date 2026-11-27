import { assert, test } from '#test'
import type { DecidedAnswers, DecidingAnswers } from './answers.ts'
import { decidedRecord, decidingRecord, recordMarkdown } from './record.ts'
import { decidedScreens, decidingReady, decidingScreens, finalOdds, oddsFarApart, skyPick } from './screens.ts'
import { sampleDecidedPlan, sampleDecidingPlan } from './testHelpers.ts'
import { toBand, toDecidingPlan, WireDeciding, withWant } from './wire.ts'

const ids = (screens: Array<{ id: string }>) => screens.map((screen) => screen.id).join(' ')

test('wizard screens: the path is as long as the decision needs', () => {
  const plan = sampleDecidingPlan()
  assert({
    given: 'nothing answered, two options kept, one want, the fast path, and "check first"',
    should:
      'ask about every option kept, skip "which comes first" for one want, shorten the fast path, and end at saving as open',
    actual: [
      ids(decidingScreens(plan, {})),
      ids(decidingScreens(plan, { options: [2, 3], wants: [0, 1] })),
      ids(decidingScreens(plan, { wants: [0] })).includes(' top '),
      ids(decidingScreens(plan, { care: 'fast' })),
      ids(decidingScreens(plan, { options: [2, 3], hinge: 'check' }))
        .split(' ')
        .slice(-2)
        .join(' '),
      ids(decidingScreens(plan, { options: [1] })).includes('hinge'),
    ],
    expected: [
      'frame care wants options out:0 out:1 out:2 out:3 hinge call answer wrong rules expect sure record',
      'frame care wants top options out:2 out:3 hinge call answer wrong rules expect sure record',
      false,
      'frame care call answer expect sure record',
      'hinge open',
      false,
    ],
  })
  assert({
    given: 'a decision already made, with and without anything the notebook knew that day',
    should: 'ask what was known only when there is something to split by date',
    actual: [
      ids(decidedScreens(sampleDecidedPlan())),
      ids(decidedScreens({ ...sampleDecidedPlan(), knew: [], since: [] })),
    ],
    expected: [
      'wording when knew wants others force expect sure record',
      'wording when wants others force expect sure record',
    ],
  })
})

test('wizard odds: the person answers first, and a wide gap has to be settled', () => {
  const plan = sampleDecidingPlan()
  const far: DecidingAnswers = { odds: { 0: 3, 2: 2 } }
  assert({
    given: 'odds two ranges above Sky’s for one option, and the same as Sky’s for another',
    should: 'hold the first until the person says whose to use, and let the second through',
    actual: [
      oddsFarApart(plan, far, 0),
      decidingReady('out:0', plan, far),
      decidingReady('out:0', plan, { ...far, oddsUse: { 0: 'middle' } }),
      finalOdds(plan, { ...far, oddsUse: { 0: 'middle' } }, 0),
      finalOdds(plan, { ...far, oddsUse: { 0: 'sky' } }, 0),
      decidingReady('out:2', plan, far),
      decidingReady('out:1', plan, far),
    ],
    expected: [true, false, true, 2, 1, true, false],
  })
  assert({
    given: 'Sky’s first choice set aside by the person',
    should: 'take Sky’s next choice among the options still on the table',
    actual: [skyPick(plan, {}), skyPick(plan, { options: [0, 1, 3] }), skyPick(plan, { options: [0, 1] })],
    expected: [2, 3, 1],
  })
})

test('wizard record: what is shown is what the decision file is written from', () => {
  const plan = sampleDecidingPlan()
  const answers: DecidingAnswers = {
    frame: 1,
    care: 'full',
    wants: [0, 1, 3],
    top: 3,
    options: [0, 2, 3],
    odds: { 0: 3, 2: 2, 3: 3 },
    oddsUse: { 0: 'middle' },
    oddsNote: { 3: 'She asked me about the role in May' },
    hinge: 'now',
    call: 3,
    final: 'keep',
    wrong: { 3: ['You kept the big deals yourself.'] },
    rules: { 3: ['Review it on Dec 31.'] },
    expect: { 3: 'By Dec 31 the team books $1.6M and Jane still wants the job' },
    sure: 3,
    look: ['2030-12-31', '2030-09-01'],
  }
  const record = decidingRecord(plan, answers)
  assert({
    given: 'a call that differs from Sky’s, with wants ordered, odds settled and a note of what Sky did not know',
    should: 'record the call, Sky’s choice, the wants in order, and the references the wants came from',
    actual: [
      record.title,
      record.call,
      record.callNote,
      record.wants,
      record.rel,
      record.look,
      record.inForce,
      record.target,
    ],
    expected: [
      'Who leads sales through the October launch',
      'Promote Jane Doe to lead sales.',
      'Sky would have chosen “Bring in a part-time sales lead for six months”.',
      [
        'Keep Jane Doe, your top account executive',
        'Keep your own time free for the October launch',
        'Reach $4M in new bookings this year',
      ],
      ['goals/Run-a-Marathon', 'goals/Learn-Spanish'],
      ['2030-09-01', '2030-12-31'],
      false,
      null,
    ],
  })
  assert({
    given: 'the same record as Markdown',
    should: 'number the wants with the first one marked, and write each section under its own heading',
    actual: recordMarkdown(record),
    expected: {
      desiredOutcomes:
        '1. Keep Jane Doe, your top account executive (comes first)\n2. Keep your own time free for the October launch\n3. Reach $4M in new bookings this year',
      record: [
        '## Options weighed\n\n- Hire a VP of Sales now. My odds for the outcome I want: 40–60%. Sky’s: 20–40%.\n- Bring in a part-time sales lead for six months. My odds for the outcome I want: 40–60%. Sky’s: 40–60%.\n- Promote Jane Doe to lead sales. My odds for the outcome I want: 60–80%. Sky’s: 40–60%. What I know that Sky did not: She asked me about the role in May.',
        '## What I expect\n\nBy Dec 31 the team books $1.6M and Jane still wants the job.\n\nHow sure: 60–80%. Look back: 2030-09-01 and 2030-12-31.',
        '## What it rests on\n\n- Jane wants to lead the team. Not checked.',
        '## What could sink it\n\n- You kept the big deals yourself.',
        '## Rules set ahead of time\n\n- Review it on Dec 31.',
      ].join('\n\n'),
      decision:
        'Promote Jane Doe to lead sales. Sky would have chosen “Bring in a part-time sales lead for six months”.',
    },
  })

  assert({
    given: 'the same call made after the decision was saved as open to check first',
    should: 'say the belief was set aside to check, without claiming how the check came out',
    actual: decidingRecord(plan, { ...answers, hinge: 'checked' }).sections.find(
      (part) => part.heading === 'What it rests on',
    )?.lines,
    expected: ['Jane wants to lead the team. Set aside to check before deciding.'],
  })

  const open = decidingRecord(plan, { ...answers, hinge: 'check', by: '2030-07-01', call: undefined }, true)
  assert({
    given: 'the same decision saved before the call, to check two things first',
    should: 'record it as open with a day to decide by, what is being weighed, and what needs checking',
    actual: [open.call, open.target, open.look, open.sections.map((part) => part.heading), open.sections.at(-1)?.lines],
    expected: [
      null,
      '2030-07-01',
      [],
      ['Options being weighed', 'What it rests on'],
      [
        'The Series B closes by September. To check: Nothing to check until the next update.',
        'Someone you trust can start as a part-time lead in July. To check: Two emails.',
        'Jane wants to lead the team. To check: One conversation.',
      ],
    ],
  })
})

test('wizard record: a decision typed in at the call keeps the reason the person gave', () => {
  const plan = sampleDecidingPlan()
  const answers: DecidingAnswers = {
    frame: 1,
    care: 'fast',
    call: 3,
    final: 'keep',
    because: { 3: 'she asked for the job, and the launch needs my time', 0: 'a reason given for another option' },
    expect: { 3: 'By Dec 31 Jane runs the team' },
    sure: 3,
    look: ['2030-12-31'],
  }
  const made = decidingRecord(plan, answers)
  assert({
    given: 'a call with a reason in the person’s own words',
    should: 'keep the reason for that call only, as a line of its own under the call in the file',
    actual: [made.because, recordMarkdown(made).decision],
    expected: [
      'she asked for the job, and the launch needs my time.',
      'Promote Jane Doe to lead sales. Sky would have chosen “Bring in a part-time sales lead for six months”.\n\nBecause: she asked for the job, and the launch needs my time.',
    ],
  })
  assert({
    given: 'the same decision while it is still open',
    should: 'keep the reason under what the person leans toward',
    actual: decidingRecord(plan, { ...answers, final: undefined }, true).sections.find(
      (part) => part.heading === 'Leaning toward',
    )?.lines,
    expected: ['Promote Jane Doe to lead sales.', 'Because: she asked for the job, and the launch needs my time.'],
  })
  assert({
    given: 'the step that asks for odds on an option',
    should: 'need them for an option Sky or the person put up to weigh, and not for a decision typed in at the call',
    actual: [
      decidingReady('out:3', plan, { ...answers, because: undefined }),
      decidingReady('out:3', plan, answers),
      decidingReady('out:3', plan, { ...answers, because: { 3: '' } }),
    ],
    expected: [false, true, true],
  })
  assert({
    given: 'a call whose reason was left empty',
    should: 'write no reason',
    actual: [
      decidingRecord(plan, { ...answers, because: { 3: '  ' } }).because,
      recordMarkdown(decidingRecord(plan, { ...answers, because: { 3: '  ' } })).decision,
    ],
    expected: [
      null,
      'Promote Jane Doe to lead sales. Sky would have chosen “Bring in a part-time sales lead for six months”.',
    ],
  })
})

test('wizard record: a decision already made rests on what was known that day', () => {
  const plan = sampleDecidedPlan()
  const answers: DecidedAnswers = {
    wording: plan.wordings[1]!.title,
    when: '2030-03-12',
    knew: [plan.knew[0]!.text],
    wants: [plan.wants[0]!.title],
    others: [plan.others[1]!.title],
    force: 'until',
    until: 'the Series B closes.',
    expect: plan.expect[0]!.text,
    sure: 3,
    look: ['2030-09-30'],
  }
  const record = decidedRecord(plan, answers)
  assert({
    given: 'one fact known on the day, one learned since, and a rule that holds until something happens',
    should: 'date it by the day it was made, keep what was learned since apart, and say what ends it',
    actual: [
      record.when,
      record.inForce,
      record.callNote,
      record.rel,
      record.sections.map((part) => `${part.heading}: ${part.lines.join(' | ')}`),
    ],
    expected: [
      '2030-03-12',
      true,
      'It holds until the Series B closes.',
      ['goals/Learn-Spanish'],
      [
        'Options not taken: Decide each senior hire case by case.',
        'What I knew that day: Burn was $520k a month against a plan of $450k. (Finance review, Mar 8)',
        'What I expected: When the round closes, burn is under $450k a month and no senior role was filled. | How sure I was: 60–80%. Look back: 2030-09-30.',
        'Learned since: The round slipped from July to the third quarter. (Investor update, Jun 6)',
      ],
    ],
  })
})

test('wizard plan: a loosely written answer from the model still makes a sound plan', () => {
  const wireOption = (key: string, title: string) => ({
    key,
    title,
    short: '',
    why: 'w',
    mine: key === 'A',
    undo: 'easy',
    breaks: ' ',
    outcomes: [
      { text: 'one', feel: 'LIKE' },
      { text: 'two', feel: 'unsure' },
      { text: 'three', feel: 'dislike' },
      { text: 'four', feel: 'dislike' },
    ],
    question: '',
    odds: key === 'A' ? '20–40%' : 'Over 80 percent',
    oddsWhy: 'why',
    effects: [{ want: 'w2', effect: 'Helps', why: ' It  frees a day a week. ' }],
    for: 'f',
    against: 'a',
    hinges: [{ belief: 'b', sure: 's', cost: 'c' }],
    wrongMine: ['m1', ' ', 'm2', 'm3', 'm4'],
    wrongLuck: ['l1'],
    rules: ['r1'],
    expect: ['e1'],
    look: ['2030-01-01', 'soon', '2030-09-01'],
  })
  const wire = WireDeciding.parse({
    category: 'professional',
    context: '  A   situation. ',
    frames: [{ title: 'One', why: 'x' }],
    frame: 7,
    care: { year: 'Yes.', undo: 'Hard.', suggest: 'FULL' },
    wants: [
      { key: 'W1', title: 'First', why: 'x', inForce: false },
      { key: 'W2', title: 'Second', why: 'x', ref: 'goals/Atlas', inForce: true },
    ],
    wantsSuggested: ['w2', 'W9'],
    options: [wireOption('A', 'Alpha'), wireOption('B', 'Beta')],
    close: ['b', 'a'],
    rank: ['B'],
  })
  const plan = toDecidingPlan(wire, '2030-06-18', '2030-09-16')
  const first = plan.options[0]!
  assert({
    given:
      'odds with an en dash, capitals where none were asked, a blank line, a past look-back day, and a rank that leaves an option out',
    should: 'settle each into what the wizard reads, without refusing the plan',
    actual: [
      [plan.category, plan.context, plan.frame, plan.care.suggest, plan.wantsSuggested, plan.close, plan.rank],
      [first.short, first.undo, first.breaks, first.odds, plan.options[1]!.odds, first.effects, first.question],
      first.effectsWhy,
      [first.outcomes.map((outcome) => outcome.feel), first.wrongMine, first.look, first.hinges[0]?.todo],
    ],
    expected: [
      ['Professional', 'A situation.', 0, 'full', [1], [1, 0], [1, 0]],
      ['Alpha', 'Easy', null, 1, 4, ['none', 'helps'], 'How likely is the first one?'],
      // One line of why beside each effect, tidied, and empty where Sky gave none.
      ['', 'It frees a day a week.'],
      [['like', 'mixed', 'dislike'], ['m1', 'm2', 'm3'], ['2030-09-01'], null],
    ],
  })
  assert({
    given: 'ranges written every way a model might',
    should: 'read each as one of the five',
    actual: ['under 20%', '<20%', '20-40%', '40 to 60%', '60–80%', 'over 80%', 'about half'].map(toBand),
    expected: [0, 0, 1, 2, 3, 4, 2],
  })
  const wider = withWant(plan, {
    want: { key: 'W3', title: 'Third', why: 'You added this.', ref: 'goals/x', inForce: true },
    effects: [{ option: 'b', effect: 'costs', why: 'It takes the budget.' }],
  })
  assert({
    given: 'a want the person typed in, with an effect for only one option',
    should: 'add it as theirs, and give every option an effect for it',
    actual: [
      wider.wants.at(-1),
      wider.options.map((item) => item.effects.at(-1)),
      wider.options.map((item) => item.effectsWhy),
    ],
    expected: [
      { title: 'Third', why: 'You added this.', ref: null, inForce: false },
      ['none', 'costs'],
      [
        ['', 'It frees a day a week.', ''],
        ['', 'It frees a day a week.', 'It takes the budget.'],
      ],
    ],
  })
})
