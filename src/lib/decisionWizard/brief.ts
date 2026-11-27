import type { DecidedAnswers, DecidingAnswers } from './answers.ts'
import { BANDS, type DecidedPlan, type DecidingPlan } from './plan.ts'
import {
  chosenOptions,
  decidedScreens,
  decidingScreens,
  finalCall,
  finalOdds,
  orderedWants,
  skyPick,
} from './screens.ts'
import type { WizardSession } from './session.ts'

/**
 * A decision as it stands in the wizard, written out for a chat about it:
 * everything Sky worked out, and everything the person has answered so far.
 *
 * The wizard holds Sky’s own odds and pick back until the person has given
 * theirs. The brief keeps that: it marks what the person has not seen yet, and
 * tells the chat to hold it until asked.
 */

const list = (items: string[]): string => items.map((item) => `- ${item}`).join('\n')
const FEEL = { like: 'he would like this', mixed: 'mixed', dislike: 'he would dislike this' } as const
const EFFECT = { helps: 'helps', costs: 'costs', none: 'no effect' } as const
const STEP: Record<string, string> = {
  frame: 'choosing how to word the decision',
  care: 'deciding how much care it deserves',
  wants: 'choosing what he wants from it',
  top: 'choosing which want comes first',
  options: 'choosing which options to weigh',
  hinge: 'deciding whether to check something first',
  open: 'setting a day to decide by',
  call: 'making the call',
  answer: 'seeing whether Sky would make the same call',
  wrong: 'picturing how it could go wrong',
  rules: 'setting rules ahead of time',
  expect: 'saying what he expects',
  sure: 'saying how sure he is',
  record: 'reading the record before saving',
  wording: 'choosing how to word what was decided',
  when: 'saying when it was decided',
  knew: 'checking what was known that day',
  others: 'naming what else was on the table',
  force: 'saying whether it still binds',
}
const stepName = (step: string | null): string =>
  !step
    ? 'at the first step'
    : step.startsWith('out:')
      ? 'going through what could happen with each option'
      : (STEP[step] ?? step)

function deciding(plan: DecidingPlan, answers: DecidingAnswers, title: string, step: string | null): string {
  const chosen = chosenOptions(plan, answers)
  const wants = orderedWants(plan, answers)
  const call = finalCall(plan, answers)
  // What the wizard has shown so far: Sky’s odds per option once his are in, Sky’s pick once his call is in.
  const reached = decidingScreens(plan, answers).findIndex((screen) => screen.id === step)
  const pastCall = answers.final !== undefined
  const held: string[] = []
  const options = plan.options.map((option, at) => {
    const mine = answers.odds?.[at]
    const final = finalOdds(plan, answers, at)
    const seen = mine !== undefined
    if (!seen && chosen.includes(at)) held.push(`Sky’s odds for “${option.title}”`)
    const feels = option.outcomes
      .map((outcome, n) => `${n + 1}. ${outcome.text} (${FEEL[answers.feels?.[`${at}.${n}`] ?? outcome.feel]})`)
      .join('\n')
    const effects = plan.wants
      .map((want, n) => `${want.title}: ${EFFECT[answers.effects?.[`${n}.${at}`] ?? option.effects[n] ?? 'none']}`)
      .join('; ')
    return [
      `### ${option.title}`,
      [
        option.mine ? 'He named this option himself.' : 'Sky added this option.',
        chosen.includes(at) ? 'He is weighing it.' : 'He dropped it from the options to weigh.',
        call === at ? 'THIS IS HIS CALL.' : '',
      ]
        .filter(Boolean)
        .join(' '),
      option.why,
      `To undo: ${option.undo}.${option.breaks ? ` It would break a decision in force: ${option.breaks}.` : ''}`,
      `What could happen:\n${feels}`,
      `Odds that the first one happens: ${
        seen
          ? `he said ${BANDS[mine]}${final !== mine && final !== undefined ? `, and settled on ${BANDS[final]}` : ''}`
          : 'he has not said yet'
      }. Sky’s: ${BANDS[option.odds]}${seen ? '' : ' (not shown to him yet)'}. ${option.oddsWhy}${option.outside ? ` ${option.outside}` : ''}`,
      answers.oddsNote?.[at] ? `What he told Sky it was missing: ${answers.oddsNote[at]}` : '',
      `Effect on what he wants: ${effects}.`,
      `For it: ${option.for}`,
      `The strongest case against it: ${option.against}`,
      option.hinges.length
        ? `It rests on:\n${list(option.hinges.map((hinge) => `${hinge.belief} ${hinge.sure} To check: ${hinge.cost}`))}`
        : '',
      `How it could fail, in his hands:\n${list(option.wrongMine)}`,
      `How it could fail, out of his hands:\n${list(option.wrongLuck)}`,
      `Rules he could set ahead of time:\n${list(option.rules)}`,
      `What he could expect to see:\n${list(option.expect)}`,
    ]
      .filter(Boolean)
      .join('\n\n')
  })
  if (!pastCall) held.push('Sky’s own pick among the options')
  const sky = skyPick(plan, answers)
  const answered = [
    answers.care ? `Path: ${answers.care === 'fast' ? 'deciding fast' : 'the full path'}.` : '',
    answers.hinge === 'check' ? 'He chose to check what it rests on before deciding.' : '',
    answers.hinge === 'checked' ? 'He saved it as open to check what it rests on, and is back to decide.' : '',
    call !== undefined
      ? `His call: ${plan.options[call]!.title}${answers.final === 'switch' ? ' (he switched to Sky’s pick)' : answers.final === 'keep' ? ' (he kept it after seeing Sky’s view)' : ''}.`
      : 'He has not made the call yet.',
    call !== undefined && answers.because?.[call]?.trim()
      ? `Why he chose it, in his own words: ${answers.because[call]!.trim()}`
      : '',
    call !== undefined && answers.wrong?.[call]?.length
      ? `What worries him about it:\n${list(answers.wrong[call]!)}`
      : '',
    call !== undefined && answers.rules?.[call]?.length
      ? `Rules he set ahead of time:\n${list(answers.rules[call]!)}`
      : '',
    call !== undefined && answers.expect?.[call] ? `What he expects: ${answers.expect[call]}` : '',
    answers.sure !== undefined && reached >= 0 ? `How sure he is of that: ${BANDS[answers.sure]}.` : '',
  ].filter(Boolean)
  return [
    `# ${title}`,
    plan.context,
    `He is ${stepName(step)}.`,
    `## What he wants${wants.length > 1 ? ', the first one first' : ''}`,
    wants.length
      ? list(wants.map((want) => `${plan.wants[want]!.title} (${plan.wants[want]!.why})`))
      : 'He has not chosen yet. Sky found these:',
    wants.length < plan.wants.length
      ? `Not chosen:\n${list(plan.wants.filter((_, at) => !wants.includes(at)).map((want) => `${want.title} (${want.why})`))}`
      : '',
    `## How much care it deserves`,
    `Will it still matter in a year? ${plan.care.year}\nHow hard is it to undo? ${plan.care.undo}`,
    `## The options`,
    ...options,
    `## Sky’s own order, best first`,
    `${plan.rank.map((at, n) => `${n + 1}. ${plan.options[at]?.title ?? ''}`).join('\n')}${
      plan.close
        ? `\n“${plan.options[plan.close[0]]?.title}” and “${plan.options[plan.close[1]]?.title}” come out close.`
        : ''
    }\nAmong the options he is weighing, Sky would choose “${plan.options[sky]?.title}”${pastCall ? '' : ' (not shown to him yet)'}.`,
    `## His answers so far`,
    answered.join('\n\n'),
    held.length
      ? `## Held back in the wizard\n\nThe wizard has him answer before it shows Sky’s answer, so one does not pull the other. He has not yet seen:\n${list(held)}\nDo not volunteer these. If he asks for them outright, give them, and say it is better to answer first.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function decided(plan: DecidedPlan, answers: DecidedAnswers, title: string, step: string | null): string {
  const steps = decidedScreens(plan).map((screen) => screen.id)
  const past = (id: string) => steps.indexOf(step ?? steps[0]!) > steps.indexOf(id)
  return [
    `# ${title}`,
    plan.context,
    `This decision was already made, and he is writing it down. He is ${stepName(step)}.`,
    `## Wordings`,
    list(plan.wordings.map((wording) => `${wording.title} (${wording.why})`)),
    `## When it was made`,
    `${list(plan.when.map((day) => `${day.date}: ${day.why}`)) || 'The notebook does not show the day.'}${answers.when ? `\nHe said: ${answers.when}.` : ''}`,
    `## What he knew that day`,
    list(plan.knew.map((item) => `${item.text} (${item.source})`)) ||
      'The notebook holds nothing from before that day.',
    plan.since.length
      ? `## Learned since, and kept out of the reasons\n\n${list(plan.since.map((item) => `${item.text} (${item.source})`))}`
      : '',
    `## What he wanted from it`,
    list(plan.wants.map((want) => `${want.title} (${want.why})`)),
    plan.others.length
      ? `## Options not taken\n\n${list(plan.others.map((other) => `${other.title} (${other.why})`))}`
      : '',
    `## Whether it still binds`,
    `${plan.force.why}${plan.force.until ? ` It would hold until ${plan.force.until.replace(/[.]$/, '')}.` : ''}`,
    `## What he expected`,
    `${list(plan.expect.map((item) => `${item.text} (${item.why})`))}${plan.quote ? `\nIn his words (${plan.quote.source}): “${plan.quote.text}”` : ''}`,
    `## His answers so far`,
    [
      answers.wording ? `Wording: ${answers.wording}` : '',
      past('knew') && answers.knew ? `Counted as known that day:\n${list(answers.knew)}` : '',
      past('wants') && answers.wants?.length ? `Wanted:\n${list(answers.wants)}` : '',
      past('others') && answers.others?.length ? `Also on the table:\n${list(answers.others)}` : '',
      answers.force
        ? `Still binds: ${answers.force === 'once' ? 'no, it was carried out once' : answers.force === 'noEnd' ? 'yes, with no end' : `yes, until ${(answers.until ?? '').replace(/[.]$/, '')}`}.`
        : '',
      answers.expect ? `Expected: ${answers.expect}` : '',
      answers.sure !== undefined ? `How sure he was: ${BANDS[answers.sure]}.` : '',
    ]
      .filter(Boolean)
      .join('\n\n') || 'None yet.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The decision of one wizard run, as Markdown. Empty while Sky is still thinking. */
export function decisionBrief(session: WizardSession): string {
  const { plan } = session
  if (!plan) return ''
  if (plan.kind === 'decided') {
    const answers = session.answers as DecidedAnswers
    return decided(plan, answers, answers.wording ?? session.statement, session.step)
  }
  const answers = session.answers as DecidingAnswers
  return deciding(plan, answers, plan.frames[answers.frame ?? -1]?.title ?? session.statement, session.step)
}
