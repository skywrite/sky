import { z } from 'zod'
import type { Band, DecidedPlan, DecidingPlan, Find, PlanOption, PlanWant } from './plan.ts'

/**
 * The shapes the model is asked to return, and the step that turns them into
 * a plan the wizard can trust.
 *
 * The schemas are deliberately loose: text, lists and descriptions, with no
 * counts, lengths or closed sets. A plan takes minutes to think through, and a
 * 161-character line or an en dash in "20–40%" should never throw it away.
 * Counts, lengths and allowed words are asked for in the descriptions and
 * settled here, so a plan is refused only when something the wizard cannot do
 * without is missing.
 *
 * The plan is too large for a provider's constrained structured output (the
 * request is refused: "compiled grammar is too large"), so the schema is given
 * to the model as the contract in the prompt and checked when the answer comes
 * back.
 *
 * The model names options and wants by key (A, B… and W1, W2…) wherever one
 * refers to another. Keys survive a reordered list; positions do not.
 */

const ODDS = ['under 20%', '20-40%', '40-60%', '60-80%', 'over 80%'] as const
const EFFECTS = ['helps', 'costs', 'none'] as const
const FEELS = ['like', 'mixed', 'dislike'] as const
const UNDOS = ['Easy', 'Costly', 'Very hard'] as const
const CATEGORIES = ['Personal', 'Professional'] as const
const PATHS = ['full', 'fast'] as const
const FORCES = ['until', 'noEnd', 'once'] as const

/** A field with a closed set of words, written as text so a stray capital never fails the whole answer. */
const word = (allowed: readonly string[], about = '') =>
  z.string().describe(`${about ? `${about} ` : ''}Exactly one of: ${allowed.map((item) => `"${item}"`).join(', ')}`)
const text = (about: string) => z.string().describe(about)
const maybe = (about: string) => z.string().nullish().describe(about)

const WireOption = z.object({
  key: text('A capital letter naming this option: A, B, C…'),
  title: text('The option as a concrete action, at most 9 words'),
  short: text('Two or three words, for a column heading'),
  why: text('One line: what choosing it means in practice'),
  mine: z.boolean().describe('True when the person named this option themselves'),
  undo: word(UNDOS, 'How hard it is to undo.'),
  breaks: maybe('The title of a decision in force this option would break, else null'),
  outcomes: z
    .array(z.object({ text: text('One sentence'), feel: word(FEELS, 'How the person would feel about it.') }))
    .describe('Exactly three ways it could realistically go; the first is the one the person hopes for'),
  question: text('"How likely is the first one: <the first outcome in a few words>?"'),
  odds: word(ODDS, 'Your own honest odds for the first outcome.'),
  oddsWhy: text('At most two sentences: the evidence from their notebook behind your odds, with the note and its day'),
  outside: maybe('One sentence on how this usually goes for people in the same position; null when you do not know'),
  effects: z
    .array(
      z.object({
        want: text('The key of a want'),
        effect: word(EFFECTS),
        why: maybe('One short line, under 14 words, on why this option has that effect on this want'),
      }),
    )
    .describe('One entry for every want'),
  for: text('One or two sentences: the best honest case for this option'),
  against: text('One or two sentences: the strongest honest case against it'),
  hinges: z
    .array(
      z.object({
        belief: text('One sentence, stated as the fact the person is assuming'),
        sure: text('What they actually know about it today'),
        cost: text('What it would take to check, in a few words'),
        todo: maybe('The check as a to-do starting with a verb; null when nothing can be checked now'),
      }),
    )
    .describe('At most two things this option depends on that the person believes but has not checked'),
  wrongMine: z
    .array(z.string())
    .describe('Three short reasons it failed that were in the person’s hands, written looking back'),
  wrongLuck: z.array(z.string()).describe('Two short reasons it failed that were outside their hands'),
  rules: z
    .array(z.string())
    .describe('Three rules they could set now: "If <something checkable> by <date>, <what they will do>."'),
  expect: z
    .array(z.string())
    .describe('Two versions of what they should expect to see, each with a date and something checkable'),
  look: z.array(z.string()).describe('One or two dates, YYYY-MM-DD, worth looking back on'),
})
type WireOption = z.infer<typeof WireOption>

const WireWant = z.object({
  key: text('W1, W2, W3…'),
  title: text('What they want from this decision, as a short phrase starting with a verb'),
  why: text('Where it comes from, in one line'),
  ref: maybe('The notebook reference behind it, copied exactly from the list of references; else null'),
  inForce: z.boolean().describe('True when it comes from a decision in force'),
})
type WireWant = z.infer<typeof WireWant>

export const WireDeciding = z.object({
  category: word(CATEGORIES),
  context: text('The situation in two or three sentences, addressed to the person as "you"; facts only'),
  frames: z
    .array(
      z.object({
        title: text('At most 12 words, no "Whether to"'),
        why: text('One line: what this wording leaves open'),
      }),
    )
    .describe('Up to three wordings of the same decision, narrowest first'),
  frame: z.number().describe('The position, from 0, of the wording you would start from'),
  care: z.object({
    year: text('One sentence answering "Will it still matter in a year?", starting with Yes or No'),
    undo: text('One or two sentences on how hard it is to undo'),
    suggest: word(PATHS, 'The path you suggest.'),
  }),
  wants: z.array(WireWant).describe('Three to five'),
  wantsSuggested: z.array(z.string()).describe('The keys of the two or three wants you are most sure apply'),
  options: z.array(WireOption).describe('Three to five'),
  close: z.array(z.string()).nullish().describe('The keys of two options that come out close, else null'),
  rank: z.array(z.string()).describe('Every option key, best first, by your own judgment'),
})

const sourced = z.object({ text: z.string(), source: text('The note it comes from, with its day') })

export const WireDecided = z.object({
  category: word(CATEGORIES),
  context: text('The situation on the day, in two or three sentences, addressed to the person as "you"; facts only'),
  wordings: z
    .array(z.object({ title: text('What was decided, at most 16 words'), why: z.string() }))
    .describe('One to three wordings: as they first said it, and with any exception they added later'),
  wording: z.number().describe('The position, from 0, of the wording you would use'),
  when: z
    .array(z.object({ date: text('YYYY-MM-DD'), why: text('The note that shows it') }))
    .describe('The days the notebook points to, most likely first; empty when the notebook does not show a day'),
  knew: z
    .array(sourced)
    .describe('What the notebook shows they knew by that day, each from a note dated on or before it'),
  since: z.array(sourced).describe('What came to light afterwards that bears on it, each from a later note'),
  wants: z.array(WireWant.omit({ key: true, inForce: true })).describe('What they wanted from it at the time'),
  others: z
    .array(z.object({ title: z.string(), why: z.string() }))
    .describe('Options that were on the table and not taken; empty when the notes show none'),
  force: z.object({
    suggest: word(
      FORCES,
      'until: it holds until something happens; noEnd: it holds for good; once: it was carried out and nothing is left to keep.',
    ),
    until: maybe('What ends it, completing "It holds until…"; null unless suggest is until'),
    why: text('One line, in their words where you can'),
  }),
  expect: z
    .array(z.object({ text: z.string(), why: z.string() }))
    .describe('One or two versions of what they expected on the day, each checkable'),
  quote: sourced
    .nullish()
    .describe('A line of their own about what they expected, word for word, with its note; null when there is none'),
  look: z.array(z.string()).describe('One or two dates, YYYY-MM-DD, worth looking back on'),
})

export const WireFinds = z.object({
  finds: z
    .array(
      z.object({
        title: text('The decision in their terms, at most 12 words'),
        why: text('One sentence: where and when it shows in the notebook'),
        decided: z.boolean().describe('True when it reads as already made'),
      }),
    )
    .describe('At most five, the most consequential first; empty when there are none'),
})

export const WireOptionExtension = z.object({
  option: WireOption,
  rank: z.array(z.string()).describe('Every option key including the new one, best first'),
  close: z.array(z.string()).nullish().describe('The keys of two options that come out close, else null'),
})

export const WireWantExtension = z.object({
  want: WireWant,
  effects: z
    .array(
      z.object({
        option: text('The key of an option'),
        effect: word(EFFECTS),
        why: maybe('One short line, under 14 words, on why that option has this effect on the want'),
      }),
    )
    .describe('One entry for every option'),
})

const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()
const lines = (list: string[] | undefined, most: number): string[] =>
  (list ?? []).map(clean).filter(Boolean).slice(0, most)
const same = (a: string, b: string): boolean => clean(a).toLowerCase() === clean(b).toLowerCase()
const isDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)

/** A value the model was given a closed set for, matched without regard to case; the fallback when it wrote something else. */
const oneOf = <T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.find((item) => same(item, value ?? '')) ?? fallback

/** The range a model's odds fall in, however it punctuated them. */
export function toBand(value: string): Band {
  const said = value.toLowerCase()
  if (/under|below|less|</.test(said)) return 0
  if (/over|above|more|>/.test(said)) return 4
  const first = Number(said.match(/\d+/)?.[0] ?? 50)
  return first >= 80 ? 4 : first >= 60 ? 3 : first >= 40 ? 2 : first >= 20 ? 1 : 0
}

/** Look-back days have to be real dates still ahead; with none, the fallback day. */
function lookDays(list: string[] | undefined, today: string, fallback: string): string[] {
  const days = [...new Set((list ?? []).map(clean).filter((day) => isDay(day) && day > today))].sort().slice(0, 2)
  return days.length ? days : [fallback]
}

function toOption(wire: WireOption, wants: Array<{ key: string }>, today: string, fallback: string): PlanOption {
  const outcomes = wire.outcomes
    .map((outcome) => ({ text: clean(outcome.text), feel: oneOf(outcome.feel, FEELS, 'mixed') }))
    .filter((outcome) => outcome.text)
    .slice(0, 3)
  if (!clean(wire.title) || !outcomes.length) throw new Error('Sky’s plan came back with an option it did not finish.')
  return {
    title: clean(wire.title),
    short: clean(wire.short) || clean(wire.title),
    why: clean(wire.why),
    mine: wire.mine,
    undo: oneOf(wire.undo, UNDOS, 'Costly'),
    breaks: clean(wire.breaks) || null,
    outcomes,
    question: clean(wire.question) || 'How likely is the first one?',
    odds: toBand(wire.odds),
    oddsWhy: clean(wire.oddsWhy),
    outside: clean(wire.outside) || null,
    effects: wants.map((want) =>
      oneOf(wire.effects.find((entry) => same(entry.want, want.key))?.effect, EFFECTS, 'none'),
    ),
    effectsWhy: wants.map((want) => clean(wire.effects.find((entry) => same(entry.want, want.key))?.why)),
    for: clean(wire.for),
    against: clean(wire.against),
    wrongMine: lines(wire.wrongMine, 3),
    wrongLuck: lines(wire.wrongLuck, 2),
    rules: lines(wire.rules, 3),
    expect: lines(wire.expect, 2),
    look: lookDays(wire.look, today, fallback),
    hinges: wire.hinges
      .map((hinge) => ({
        belief: clean(hinge.belief),
        sure: clean(hinge.sure),
        cost: clean(hinge.cost),
        todo: clean(hinge.todo) || null,
      }))
      .filter((hinge) => hinge.belief)
      .slice(0, 2),
  }
}

const toWant = (wire: WireWant): PlanWant => ({
  title: clean(wire.title),
  why: clean(wire.why),
  ref: clean(wire.ref) || null,
  inForce: wire.inForce,
})

/** Option keys to their places, best first, with any the model left out added at the end. */
function ranking(keys: string[], options: Array<{ key: string }>): number[] {
  const rank = [
    ...new Set(keys.map((key) => options.findIndex((option) => same(option.key, key))).filter((at) => at >= 0)),
  ]
  for (let at = 0; at < options.length; at++) if (!rank.includes(at)) rank.push(at)
  return rank
}
function closePair(keys: string[] | null | undefined, options: Array<{ key: string }>): [number, number] | null {
  const pair = (keys ?? []).map((key) => options.findIndex((option) => same(option.key, key))).filter((at) => at >= 0)
  return pair.length === 2 && pair[0] !== pair[1] ? [pair[0]!, pair[1]!] : null
}
const place = (value: number, size: number): number => Math.min(Math.max(0, Math.round(value) || 0), size - 1)

/** `today` and `fallback` are YYYY-MM-DD: the notebook's day, and the look-back day used when the model gives none. */
export function toDecidingPlan(wire: z.infer<typeof WireDeciding>, today: string, fallback: string): DecidingPlan {
  const frames = wire.frames
    .map((frame) => ({ title: clean(frame.title), why: clean(frame.why) }))
    .filter((frame) => frame.title)
    .slice(0, 3)
  const wireWants = wire.wants.filter((want) => clean(want.title)).slice(0, 6)
  const wireOptions = wire.options.filter((option) => clean(option.title)).slice(0, 5)
  if (!frames.length || !wireWants.length || wireOptions.length < 2)
    throw new Error(
      'Sky’s plan came back incomplete: it needs a wording, something you want, and at least two options.',
    )
  return {
    kind: 'deciding',
    category: oneOf(wire.category, CATEGORIES, 'Professional'),
    context: clean(wire.context),
    frames,
    frame: place(wire.frame, frames.length),
    care: {
      year: clean(wire.care.year),
      undo: clean(wire.care.undo),
      suggest: oneOf(wire.care.suggest, PATHS, 'full'),
    },
    wants: wireWants.map(toWant),
    wantsSuggested: [
      ...new Set(
        wire.wantsSuggested.map((key) => wireWants.findIndex((want) => same(want.key, key))).filter((at) => at >= 0),
      ),
    ],
    options: wireOptions.map((option) => toOption(option, wireWants, today, fallback)),
    close: closePair(wire.close, wireOptions),
    rank: ranking(wire.rank, wireOptions),
  }
}

export function toDecidedPlan(wire: z.infer<typeof WireDecided>, today: string, fallback: string): DecidedPlan {
  const wordings = wire.wordings
    .map((wording) => ({ title: clean(wording.title), why: clean(wording.why) }))
    .filter((wording) => wording.title)
    .slice(0, 3)
  const wants = wire.wants
    .map((want) => ({ title: clean(want.title), why: clean(want.why), ref: clean(want.ref) || null }))
    .filter((want) => want.title)
    .slice(0, 5)
  const expect = wire.expect
    .map((item) => ({ text: clean(item.text), why: clean(item.why) }))
    .filter((item) => item.text)
    .slice(0, 2)
  if (!wordings.length || !wants.length || !expect.length)
    throw new Error('Sky’s read came back incomplete: it needs a wording, what you wanted, and what you expected.')
  const from = (list: Array<{ text: string; source: string }>, most: number) =>
    list
      .map((item) => ({ text: clean(item.text), source: clean(item.source) }))
      .filter((item) => item.text)
      .slice(0, most)
  return {
    kind: 'decided',
    category: oneOf(wire.category, CATEGORIES, 'Professional'),
    context: clean(wire.context),
    wordings,
    wording: place(wire.wording, wordings.length),
    // A decision cannot have been made on a day that has not happened.
    when: wire.when
      .map((day) => ({ date: clean(day.date), why: clean(day.why) }))
      .filter((day) => isDay(day.date) && day.date <= today)
      .slice(0, 3),
    knew: from(wire.knew, 6),
    since: from(wire.since, 4),
    wants,
    others: wire.others
      .map((item) => ({ title: clean(item.title), why: clean(item.why) }))
      .filter((item) => item.title)
      .slice(0, 4),
    force: {
      suggest: oneOf(wire.force.suggest, FORCES, 'once'),
      until: clean(wire.force.until) || null,
      why: clean(wire.force.why),
    },
    expect,
    quote:
      wire.quote && clean(wire.quote.text) ? { text: clean(wire.quote.text), source: clean(wire.quote.source) } : null,
    look: lookDays(wire.look, today, fallback),
  }
}

export function toFinds(wire: z.infer<typeof WireFinds>): Find[] {
  return wire.finds
    .map((find) => ({ title: clean(find.title), why: clean(find.why), decided: find.decided }))
    .filter((find) => find.title)
    .slice(0, 5)
}

/** The keys the plan's options and wants are known by when Sky is asked to add to it. */
export const optionKey = (at: number): string => String.fromCharCode(65 + at)
export const wantKey = (at: number): string => `W${at + 1}`

/** A typed-in option, worked out by Sky, added to the end of the plan. */
export function withOption(
  plan: DecidingPlan,
  wire: z.infer<typeof WireOptionExtension>,
  today: string,
  fallback: string,
): DecidingPlan {
  const keys = [...plan.options.map((_, at) => ({ key: optionKey(at) })), { key: optionKey(plan.options.length) }]
  const option = toOption(
    { ...wire.option, key: optionKey(plan.options.length), mine: true },
    plan.wants.map((_, at) => ({ key: wantKey(at) })),
    today,
    fallback,
  )
  return {
    ...plan,
    options: [...plan.options, option],
    rank: ranking(wire.rank, keys),
    close: closePair(wire.close, keys),
  }
}

/**
 * A decision typed in at the call is recorded in the person's own words. Sky rewords what it is given, which suits
 * an option put up to weigh; a decision the person has made keeps their wording, and Sky's short name for it.
 */
export function inOwnWords(plan: DecidingPlan, text: string): DecidingPlan {
  const last = plan.options.length - 1
  return { ...plan, options: plan.options.map((option, at) => (at === last ? { ...option, title: text } : option)) }
}

/** A typed-in want, with its effect on every option, added to the end of the plan. */
export function withWant(plan: DecidingPlan, wire: z.infer<typeof WireWantExtension>): DecidingPlan {
  const want = toWant(wire.want)
  if (!want.title) throw new Error('Sky could not work out what you want from that.')
  return {
    ...plan,
    wants: [...plan.wants, { ...want, ref: null, inForce: false }],
    options: plan.options.map((option, at) => ({
      ...option,
      effects: [
        ...option.effects,
        oneOf(wire.effects.find((entry) => same(entry.option, optionKey(at)))?.effect, EFFECTS, 'none'),
      ],
      // A plan from before reasons were kept has none for its earlier wants; the new one still gets its own.
      effectsWhy: [
        ...(option.effectsWhy ?? option.effects.map(() => '')),
        clean(wire.effects.find((entry) => same(entry.option, optionKey(at)))?.why),
      ],
    })),
  }
}
