import type { DecidedAnswers, DecidingAnswers } from './answers.ts'
import { BANDS, type Category, type DecidedPlan, type DecidingPlan } from './plan.ts'
import { chosenOptions, finalCall, finalOdds, orderedWants, skyPick } from './screens.ts'

/**
 * The record the wizard ends in: everything the person chose, in the order the
 * decision's file reads. The page previews it and the server writes it, from
 * this one builder, so what is shown is what is saved.
 */
export interface DecisionRecord {
  title: string
  category: Category
  /** The situation, for the top of the file */
  context: string
  /** The day it was made, YYYY-MM-DD, when that was not today */
  when: string | null
  /** What was decided; null while the decision is still open */
  call: string | null
  /** A line under the call: what Sky would have chosen, or what ends it */
  callNote: string | null
  inForce: boolean
  /** What the person wants from it */
  wants: string[]
  /** The person said which want comes first when two pull apart, and it leads the list */
  wantsOrdered: boolean
  /** The rest of the record, each a heading with its lines */
  sections: Array<{ heading: string; lines: string[]; list: boolean }>
  /** Notebook references it weighs on */
  rel: string[]
  /** The days Sky asks how it went, YYYY-MM-DD */
  look: string[]
  /** The day an open decision should be made by */
  target: string | null
}

const section = (heading: string, lines: string[], list = true) => (lines.length ? [{ heading, lines, list }] : [])
const sentence = (text: string) => (/[.!?…”"]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

/**
 * A decision worked through in the wizard. `open` is the record while the call
 * is not made: what is wanted, what is being weighed, what still needs
 * checking, and what the person leans toward once they have picked.
 */
export function decidingRecord(
  plan: DecidingPlan,
  answers: DecidingAnswers,
  open = false,
  /** The decision in the person's own words, used until they choose a wording */
  statement?: string,
): DecisionRecord {
  const fast = answers.care === 'fast'
  const chosen = chosenOptions(plan, answers)
  const wants = orderedWants(plan, answers)
  // While it is open the pick is a leaning: it is written down, and it is not yet the call.
  const call = finalCall(plan, answers)
  const option = call === undefined ? undefined : plan.options[call]!
  const sky = skyPick(plan, answers)
  // Sky's own pick is said only once the wizard has shown it.
  const skyNote =
    option && call !== sky && answers.final !== undefined && answers.final !== 'switch'
      ? `Sky would have chosen “${plan.options[sky]!.title}”.`
      : null
  const weighed = chosen.map((index) => {
    const odds = finalOdds(plan, answers, index)
    const note = answers.oddsNote?.[index]
    return (
      sentence(plan.options[index]!.title) +
      (odds === undefined
        ? ''
        : ` My odds for the outcome I want: ${BANDS[odds]}. Sky’s: ${BANDS[plan.options[index]!.odds]}.`) +
      (note ? ` What I know that Sky did not: ${sentence(note)}` : '')
    )
  })
  const rests = open
    ? chosen.flatMap((index) =>
        plan.options[index]!.hinges.map((hinge) => `${sentence(hinge.belief)} To check: ${sentence(hinge.cost)}`),
      )
    : (option?.hinges ?? []).map(
        (hinge) =>
          `${sentence(hinge.belief)} ${answers.hinge === 'checked' ? 'Set aside to check before deciding.' : 'Not checked.'}`,
      )
  const expect = call === undefined ? undefined : answers.expect?.[call]
  const lookDays = [...new Set(answers.look ?? [])].sort()
  return {
    title:
      plan.frames[answers.frame ?? -1]?.title ?? statement ?? plan.frames[plan.frame]?.title ?? plan.frames[0]!.title,
    category: answers.category ?? plan.category,
    context: plan.context,
    when: null,
    call: option && !open ? sentence(option.title) : null,
    callNote: open ? null : skyNote,
    inForce: !open && answers.force === true,
    wants: fast ? [] : wants.map((want) => plan.wants[want]!.title),
    wantsOrdered: !fast && wants.length > 1,
    sections: [
      ...(fast && !open ? [] : section(open ? 'Options being weighed' : 'Options weighed', weighed)),
      ...(open && option
        ? section('Leaning toward', [[sentence(option.title), skyNote].filter(Boolean).join(' ')], false)
        : []),
      ...(expect
        ? section(
            'What I expect',
            [
              sentence(expect),
              `How sure: ${answers.sure === undefined ? 'not said' : BANDS[answers.sure]}. Look back: ${lookDays.join(' and ') || 'no date set'}.`,
            ],
            false,
          )
        : []),
      ...section('What it rests on', rests),
      ...(call === undefined ? [] : section('What could sink it', (answers.wrong?.[call] ?? []).map(sentence))),
      ...(call === undefined ? [] : section('Rules set ahead of time', (answers.rules?.[call] ?? []).map(sentence))),
    ],
    rel: [...new Set(wants.flatMap((want) => (plan.wants[want]!.ref ? [plan.wants[want]!.ref!] : [])))],
    look: open ? [] : lookDays,
    target: open ? (answers.by ?? null) : null,
  }
}

/** A decision that was already made, rebuilt from what the notebook held that day. */
export function decidedRecord(plan: DecidedPlan, answers: DecidedAnswers): DecisionRecord {
  const wording = answers.wording ?? plan.wordings[plan.wording]!.title
  const knew = [...plan.knew, ...plan.since].filter((item) => (answers.knew ?? []).includes(item.text))
  const since = plan.since.filter((item) => !(answers.knew ?? []).includes(item.text))
  const look = [...new Set(answers.look ?? [])].sort()
  const wants = answers.wants ?? []
  return {
    title: wording,
    category: answers.category ?? plan.category,
    context: plan.context,
    when: answers.when ?? null,
    call: sentence(wording),
    callNote:
      answers.force === 'until' && answers.until ? `It holds until ${answers.until.replace(/[.]$/, '')}.` : null,
    inForce: answers.force === 'until' || answers.force === 'noEnd',
    wants,
    // Nobody ranked what was wanted back then, so the record does not claim an order.
    wantsOrdered: false,
    sections: [
      ...section('Options not taken', (answers.others ?? []).map(sentence)),
      ...section(
        'What I knew that day',
        knew.map((item) => `${sentence(item.text)} (${item.source.replace(/[.]$/, '')})`),
      ),
      ...(answers.expect
        ? section(
            'What I expected',
            [
              sentence(answers.expect),
              `How sure I was: ${answers.sure === undefined ? 'not said' : BANDS[answers.sure]}. Look back: ${look.join(' and ') || 'no date set'}.`,
            ],
            false,
          )
        : []),
      ...section(
        'Learned since',
        since.map((item) => `${sentence(item.text)} (${item.source.replace(/[.]$/, '')})`),
      ),
    ],
    rel: [...new Set(plan.wants.flatMap((want) => (want.ref && wants.includes(want.title) ? [want.ref] : [])))],
    look,
    target: null,
  }
}

/** The record as the three pieces a decision file is written from. */
export function recordMarkdown(record: DecisionRecord): {
  desiredOutcomes: string
  record: string
  decision: string | undefined
} {
  return {
    desiredOutcomes: record.wants
      .map((want, n) => (record.wantsOrdered ? `${n + 1}. ${want}${n === 0 ? ' (comes first)' : ''}` : `- ${want}`))
      .join('\n'),
    record: record.sections
      .map(
        ({ heading, lines, list }) =>
          `## ${heading}\n\n${list ? lines.map((line) => `- ${line}`).join('\n') : lines.join('\n\n')}`,
      )
      .join('\n\n'),
    decision: record.call === null ? undefined : [record.call, record.callNote].filter(Boolean).join(' '),
  }
}
