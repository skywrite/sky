import type { DecidedPlan, DecidingPlan, PlanOption } from './plan.ts'

/** A made-up decision, thought through: who leads sales while the founder runs a launch. Tests share it. */
export const SAMPLE_TODAY = '2030-06-18'

const option = (fields: Partial<PlanOption> & Pick<PlanOption, 'title' | 'short' | 'why' | 'effects'>): PlanOption => ({
  mine: false,
  undo: 'Easy',
  breaks: null,
  outcomes: [
    { text: `${fields.short} goes as hoped.`, feel: 'like' },
    { text: `${fields.short} takes longer than planned.`, feel: 'mixed' },
    { text: `${fields.short} goes badly.`, feel: 'dislike' },
  ],
  question: `How likely is the first one: ${fields.short.toLowerCase()} goes as hoped?`,
  odds: 2,
  oddsWhy: 'Your notes show this has gone both ways (journal, Jun 12).',
  outside: 'It usually takes longer than people plan for.',
  for: `${fields.short} is the simplest to start.`,
  against: `${fields.short} leaves the hard part for later.`,
  wrongMine: ['You never wrote down what the job was.', 'You kept the big deals yourself.', 'You set no end date.'],
  wrongLuck: ['The launch slipped two months.', 'A competitor cut prices.'],
  rules: [
    'If the scope is not written by Jul 15, pause.',
    'If the pipeline is under $1.2M on Sep 1, reopen this decision.',
    'Review it on Dec 31.',
  ],
  expect: ['By Dec 31, $1.8M in new bookings.', 'By Dec 31, sales takes you under five hours a week.'],
  look: ['2030-09-01', '2030-12-31'],
  hinges: [],
  ...fields,
})

export function sampleDecidingPlan(): DecidingPlan {
  return {
    kind: 'deciding',
    category: 'Professional',
    context: 'You lead sales yourself, and the October launch needs most of your time from July.',
    frames: [
      {
        title: 'Hire a VP of Sales now, or after the October launch',
        why: 'How you put it. Two options, both about one hire.',
      },
      {
        title: 'Who leads sales through the October launch',
        why: 'The need behind it. Leaves room for answers that are not a VP hire.',
      },
      { title: 'How to reach $4M in new bookings this year', why: 'Wider still. Probably more than one decision.' },
    ],
    frame: 1,
    care: {
      year: 'Yes. Whoever leads sales shapes the year’s bookings.',
      undo: 'It depends on the option. A senior hire takes months to reverse. A contract does not.',
      suggest: 'full',
    },
    wants: [
      {
        title: 'Keep your own time free for the October launch',
        why: 'From your goal: Launch Atlas 2 in October.',
        ref: 'goals/Run-a-Marathon',
        inForce: false,
      },
      {
        title: 'Reach $4M in new bookings this year',
        why: 'From your goal: $4M in new bookings.',
        ref: 'goals/Learn-Spanish',
        inForce: false,
      },
      {
        title: 'Stay inside the hiring plan',
        why: 'From a decision in force since Mar 2: No late nights before a long run.',
        ref: 'decisions/No-Late-Nights',
        inForce: true,
      },
      {
        title: 'Keep Jane Doe, your top account executive',
        why: 'From your notes on the Jun 12 one-on-one.',
        ref: null,
        inForce: false,
      },
    ],
    wantsSuggested: [0, 1, 2],
    options: [
      option({
        title: 'Hire a VP of Sales now',
        short: 'Hire a VP now',
        why: 'Start the search this month.',
        mine: true,
        undo: 'Very hard',
        breaks: 'No senior hires before the Series B closes',
        odds: 1,
        effects: ['costs', 'helps', 'costs', 'costs'],
        hinges: [
          {
            belief: 'The Series B closes by September.',
            sure: 'The lead investor said “third quarter” on Jun 6.',
            cost: 'Nothing to check until the next update.',
            todo: null,
          },
        ],
      }),
      option({
        title: 'Wait until after the launch',
        short: 'Wait until November',
        why: 'You keep leading sales until November. Nothing changes now.',
        mine: true,
        odds: 1,
        effects: ['costs', 'costs', 'none', 'costs'],
      }),
      option({
        title: 'Bring in a part-time sales lead for six months',
        short: 'Part-time lead',
        why: 'A contractor runs the pipeline. You decide on a VP after the launch.',
        effects: ['helps', 'helps', 'none', 'none'],
        hinges: [
          {
            belief: 'Someone you trust can start as a part-time lead in July.',
            sure: 'Neither of the two people has been asked.',
            cost: 'Two emails.',
            todo: 'Email Sam Rivera and Priya Shah about July',
          },
        ],
      }),
      option({
        title: 'Promote Jane Doe to lead sales',
        short: 'Promote Jane',
        why: 'She runs the team now. A VP search can still happen later.',
        undo: 'Costly',
        odds: 2,
        effects: ['helps', 'helps', 'none', 'helps'],
        hinges: [
          {
            belief: 'Jane wants to lead the team.',
            sure: 'You think so. You have not asked her.',
            cost: 'One conversation.',
            todo: 'Ask Jane whether she wants to lead the team',
          },
        ],
      }),
    ],
    close: [2, 3],
    rank: [2, 3, 1, 0],
  }
}

export function sampleDecidedPlan(): DecidedPlan {
  return {
    kind: 'decided',
    category: 'Professional',
    context: 'Burn was over plan in March and the lead investor wanted the round closed first.',
    wordings: [
      { title: 'No senior hires before the Series B closes', why: 'As you said it on Mar 12.' },
      {
        title: 'No new hires at director level or above until the Series B closes, backfills excepted',
        why: 'With the exception you made on Apr 2.',
      },
    ],
    wording: 1,
    when: [
      { date: '2030-03-12', why: 'You told the leadership meeting (meeting notes).' },
      { date: '2030-03-09', why: 'Your journal that night: “I think we stop senior hiring until the round is done.”' },
    ],
    knew: [
      { text: 'Burn was $520k a month against a plan of $450k.', source: 'Finance review, Mar 8' },
      {
        text: 'The lead investor wanted the round closed before any new senior salaries.',
        source: 'Call notes, Mar 5',
      },
    ],
    since: [{ text: 'The round slipped from July to the third quarter.', source: 'Investor update, Jun 6' }],
    wants: [
      { title: 'Get burn back under $450k a month', why: 'From the Mar 8 finance review.', ref: 'goals/Learn-Spanish' },
      {
        title: 'Close the Series B without new senior salaries on the books',
        why: 'From the Mar 5 investor call.',
        ref: null,
      },
    ],
    others: [
      { title: 'Freeze all hiring, not only senior roles', why: 'Raised by your finance lead on Mar 8.' },
      { title: 'Decide each senior hire case by case', why: 'How it had worked until then.' },
    ],
    force: { suggest: 'until', until: 'the Series B closes', why: 'You said “until the round is done”.' },
    expect: [
      {
        text: 'When the round closes, burn is under $450k a month and no senior role was filled.',
        why: 'The result you were after.',
      },
      { text: 'By Sep 30 the Series B has closed, with no new senior salaries added.', why: 'With a date on it.' },
    ],
    quote: { text: 'If we hold the line, the round closes in July.', source: 'Journal, Mar 9' },
    look: ['2030-09-30'],
  }
}
