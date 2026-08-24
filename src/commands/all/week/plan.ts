import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as p from '@clack/prompts'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { Arg, Command, CommandResult, isFailOrError } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_TIME } from '#config'
import exists from '#shared/fs/exists.ts'
import { fetchNow, weekDir } from '#shared/nbfs/mod.ts'
import { PlainDateTime, Week } from '#universal/dates/nbdt/mod.ts'
import { draftWeekMarkdown, type InterviewAnswers, type LaterItems, type RefineAnswer } from './lib/draftWeek.ts'
import { gatherPlanContext } from './lib/planContext.ts'
import { generateRefineQuestions } from './lib/refineQuestions.ts'
import { parsePriorities, renderWeekMarkdown } from './lib/weekMarkdown.ts'
import { appendWeekNext } from './lib/weekNext.ts'

const INTERVIEW: { key: 'immovable' | 'drop'; message: string }[] = [
  { key: 'immovable', message: 'Anything immovable — travel, events, constraints?' },
  { key: 'drop', message: 'Anything to drop or push?' },
]

const params = {
  week: Arg.string('Week to plan (e.g., 34, W34, 2027-W02) — required for now', { optional: true }),
}

type Params = InferParams<typeof params>

export default class WeekPlanTask extends Command {
  static override description: CommandDescription = {
    name: 'week:plan',
    description: 'Plan a week: interview + notebook context draft week.md, scaffold days if needed, open it.',
    params,
  }

  async run({ context, args, tasks }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context

    const now = await fetchNow()
    const today = now.plainDateTime.plainDate
    const current = Week.of(now)

    // explicit week only, for now — smart target derivation comes later
    if (!args.week) {
      return CommandResult.error(
        `Pass the week to plan — e.g. week:plan ${current.number} for the current week (${current.toString()})`,
      )
    }

    let week: Week
    try {
      week = Week.parse(args.week, current.year)
    } catch (err) {
      return CommandResult.error(err instanceof Error ? err.message : String(err))
    }

    const wd = path.join(DIR_TIME, weekDir(week.startInYear))
    const weekMdPath = path.join(wd, 'week.md')

    if (!(await exists(wd))) {
      output.log(`Week directory missing — running week:new for ${week.toString()}`)
      const result = await tasks.run('week:new', { when: new PlainDateTime(week.startInYear) })
      if (isFailOrError(result)) return result
    }

    // week.md is the user's pen after the draft — an existing one is opened, never redrafted
    if (await exists(weekMdPath)) {
      output.log(`${week.toString()} already has a week.md — opening it.`)
      await openEditor([{ file: weekMdPath }])
      return CommandResult.success()
    }

    const prevMdPath = path.join(DIR_TIME, weekDir(week.previous().startInYear), 'week.md')
    const priorities = (await exists(prevMdPath)) ? parsePriorities(await readFile(prevMdPath, 'utf8')) : []

    p.intro(`Planning ${week.toString()}`)
    const answers: InterviewAnswers = { dump: [] }

    // the brain-dump: the user supplies the WHAT, the draft supplies the order
    for (;;) {
      const item = await p.text({
        message: answers.dump.length
          ? `Anything else? (${answers.dump.length} so far)`
          : 'What do you want to get done this week? (one item at a time)',
        placeholder: 'enter to finish',
      })
      if (p.isCancel(item)) {
        p.cancel('Planning cancelled — nothing written.')
        return CommandResult.error('Cancelled')
      }
      if (!item?.trim()) break
      answers.dump.push(item.trim())
    }

    for (const { key, message } of INTERVIEW) {
      const answer = await p.text({ message, placeholder: 'enter to skip' })
      if (p.isCancel(answer)) {
        p.cancel('Planning cancelled — nothing written.')
        return CommandResult.error('Cancelled')
      }
      if (answer?.trim()) answers[key] = answer.trim()
    }

    output.log('Reading your notebook context...')
    const planContext = await gatherPlanContext(week, today)
    output.log(`${colors.cyan('Drafting from:')}\n  ${planContext.manifest.join('\n  ')}`)

    // refine: context-aware follow-ups, asked only when the model has some
    const questions = await generateRefineQuestions({
      week,
      priorities,
      context: planContext,
      answers,
      createdYmd: today.ymd,
    })
    const refine: RefineAnswer[] = []
    for (const question of questions) {
      const answer = await p.text({ message: question, placeholder: 'enter to skip' })
      if (p.isCancel(answer)) {
        p.cancel('Planning cancelled — nothing written.')
        return CommandResult.error('Cancelled')
      }
      if (answer?.trim()) refine.push({ question, answer: answer.trim() })
    }

    output.log('Drafting...')
    const drafted = await draftWeekMarkdown({
      week,
      priorities,
      context: planContext,
      answers,
      refine,
      createdYmd: today.ymd,
    })
    if (!drafted) output.log('AI draft unavailable — writing the plain template instead.')

    await writeFile(weekMdPath, drafted?.file ?? renderWeekMarkdown(week, today.ymd, priorities))
    output.log(`Created ${weekMdPath}`)

    if (drafted) {
      const queues: [keyof LaterItems, string][] = [
        ['professional', 'next-professional.md'],
        ['personal', 'next-personal.md'],
      ]
      for (const [kind, filename] of queues) {
        const items = drafted.later[kind]
        if (!items.length) continue
        const queuePath = path.join(DIR_TIME, filename)
        const existing = (await exists(queuePath)) ? await readFile(queuePath, 'utf8') : ''
        await writeFile(queuePath, appendWeekNext(existing, items, week.toString()))
        output.log(`Deferred ${items.length} → ${filename} (## Week-Next)`)
      }
    } else if (answers.drop) {
      output.log(`Not routed anywhere without the AI draft — place it yourself: ${answers.drop}`)
    }

    // no wait — the editor outlives the command, which exits immediately
    await openEditor([{ file: weekMdPath }])

    return CommandResult.success()
  }
}
