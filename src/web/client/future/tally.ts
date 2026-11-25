import type { DecidingAnswers } from '#lib/decisionWizard/answers.ts'
import type { DecidingPlan, Effect } from '#lib/decisionWizard/plan.ts'
import { chosenOptions, finalCall, orderedWants, skyPick } from '#lib/decisionWizard/screens.ts'

/**
 * The counting behind a decision's weighing: what each option does to each want, which options are shown,
 * and what Sky says under the grid. No page in here, so it is tested on its own.
 */

/** What the grid shows for one option against one want: Sky's read, or the person's where they changed it. */
export function effectOf(
  plan: DecidingPlan,
  answers: DecidingAnswers,
  want: number,
  option: number,
): { effect: Effect; why: string } {
  const sky = plan.options[option]!.effects[want] ?? 'none'
  const mine = answers.effects?.[`${want}.${option}`]
  // Sky's reason explains Sky's read; where the person changed the read, it no longer applies.
  return mine && mine !== sky
    ? { effect: mine, why: '' }
    : { effect: sky, why: plan.options[option]!.effectsWhy?.[want] ?? '' }
}

/** The options being weighed and the wants they are weighed against, as the grid lays them out. */
export function weighed(plan: DecidingPlan, answers: DecidingAnswers): { options: number[]; wants: number[] } {
  const wants = orderedWants(plan, answers)
  // Before the person has said what they want, every want Sky found is shown.
  return { options: chosenOptions(plan, answers), wants: wants.length ? wants : plan.wants.map((_, at) => at) }
}

const count = (n: number): string => ['none', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? String(n)

/**
 * What Sky says under the weighing, in a few plain sentences: which option serves the most of what the person
 * wants, whether two come out close, and Sky's own pick once the wizard has shown it.
 */
export function weighingSummary(plan: DecidingPlan, answers: DecidingAnswers): string[] {
  const { options, wants } = weighed(plan, answers)
  const scored = options.map((option) => {
    const effects = wants.map((want) => effectOf(plan, answers, want, option).effect)
    return {
      option,
      helps: effects.filter((effect) => effect === 'helps').length,
      costs: effects.filter((effect) => effect === 'costs').length,
    }
  })
  const net = (item: (typeof scored)[number]) => item.helps - item.costs
  const top = [...scored].sort((a, b) => net(b) - net(a) || b.helps - a.helps)[0]
  // Every option that does as well as the best one: a tie is said as a tie.
  const best = top ? scored.filter((item) => net(item) === net(top) && item.helps === top.helps) : []
  const lines: string[] = []
  if (top && wants.length) {
    const named = best.map((item) => `“${plan.options[item.option]!.short}”`)
    const of =
      top.helps < wants.length
        ? `${count(top.helps)} of the ${count(wants.length)} things you want`
        : wants.length === 1
          ? 'the one thing you want'
          : `all ${count(wants.length)} things you want`
    if (!top.helps) lines.push('None of the options helps what you want more than it costs.')
    else if (best.length === 1)
      lines.push(
        `${named[0]} helps ${of}${top.costs ? ` and costs ${count(top.costs)}` : ''}, more than any other option.`,
      )
    else
      lines.push(
        `${named.slice(0, -1).join(', ')} and ${named.at(-1)} each help ${of}${top.costs ? ` and cost ${count(top.costs)}` : ''}.`,
      )
  }
  if (plan.close && plan.close.every((option) => options.includes(option)))
    lines.push(
      `Sky’s read is that “${plan.options[plan.close[0]]!.short}” and “${plan.options[plan.close[1]]!.short}” come out close, so you cannot be far wrong between them.`,
    )
  // Sky's own pick is said only once the wizard has shown it: the person answers first.
  const call = finalCall(plan, answers)
  if (answers.final !== undefined && call !== undefined) {
    const sky = skyPick(plan, answers)
    lines.push(sky === call ? 'Sky would make the same call.' : `Sky would choose “${plan.options[sky]!.short}”.`)
  }
  return lines
}
