import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { categoryComplete, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type { StreakSchedule } from '#shared/models/Streak/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'
import { SlugCollisionError, TitleCollisionError, writeStreak } from './lib/write.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  title: Flag.string('Daily-checklist title: 2-6 word imperative, e.g. "Eat clean"', { required: true }),
  why: Flag.string('1-3 sentences linking the behavior to the outcome the user wants — from streaks_clarify', {
    required: true,
  }),
  schedule: Flag.string('Schedule: "daily" or "weekdays"', {
    parse: (val: string) => {
      const v = val.trim().toLowerCase()
      if (v !== 'daily' && v !== 'weekdays') throw new Error('schedule must be "daily" or "weekdays"')
      return v
    },
    default: () => 'daily',
  }),
  start: Flag.string('First tracked day, "YYYY-MM-DD" (defaults to today; a past date backfills)', {
    optional: true,
  }),
  end: Flag.string('Planned last tracked day, "YYYY-MM-DD" (omit for open-ended)', { optional: true }),
  details: Flag.string('Detailed rules, kept verbatim below the why', { optional: true }),
  name: Flag.string('Slug override (otherwise derived from the title)', { short: 'n', optional: true }),
  tags: Flag.string('Comma- or semicolon-separated tags; omit unless the user named some', { optional: true }),
  rel: Flag.string('Semicolon-separated notebook references, from streaks_clarify', { optional: true }),
  category: categoryComplete({ defaultCategory: 'Personal' }),
}

type Params = InferParams<typeof params>
type Result = { file: string; name: string; dayItem: string; stamped: boolean }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'streaks:create': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

@AIChatTool({ needsApproval: true })
export default class StreaksCreateTask extends Command {
  static override description: CommandDescription = {
    name: 'streaks:create',
    description:
      'Write a streak rule doc into the notebook (active/), stamp its start day, and add the day item. Headless — pass fields produced by streaks_clarify; the user approves before anything is written.',
    descriptionLong: [
      'Creates the streak exactly as streaks:new would, from explicit fields.',
      'No AI calls — pure write with name/title collision checks.',
    ],
    usage: ['sky streaks:create --title "Eat clean" --why "..." --schedule daily --start 2026-08-10'],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    output.log(`  Streak:   ${String(input.title ?? '')}`)
    output.log(`  Schedule: ${input.schedule ? String(input.schedule) : 'daily'}`)
    output.log(`  Start:    ${input.start ? String(input.start) : 'today'}`)
    if (input.end) output.log(`  End:      ${String(input.end)}`)
    output.log(`  Category: ${input.category ? String(input.category) : 'Personal Complete'}`)
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { title, why, name, category } = args
    const schedule = args.schedule as StreakSchedule

    const now = await fetchNow()
    const today = now.plainDateTime.plainDate

    let start = today
    if (args.start?.trim()) {
      try {
        start = new PlainDate(args.start.trim())
      } catch {
        return CommandResult.fail(`start "${args.start}" is not a valid YYYY-MM-DD date`)
      }
    }

    let end: PlainDate | undefined
    if (args.end?.trim()) {
      try {
        end = new PlainDate(args.end.trim())
      } catch {
        return CommandResult.fail(`end "${args.end}" is not a valid YYYY-MM-DD date`)
      }
      if (PlainDate.compare(end, start) < 0) {
        return CommandResult.fail(`end ${end.ymd} is before start ${start.ymd}`)
      }
    }

    const finalName = (name ? slugify(name, { preserveCase: true }) : '') || slugify(title, { suggestedLength: 20 })

    if (!finalName) {
      return CommandResult.fail('Could not derive a usable slug — pass name')
    }

    const tags = args.tags?.trim() ? TagSet.fromArray(args.tags.split(/[;,]/)) : undefined

    // rel values must resolve in the notebook's reference vocabulary —
    // anything else would sit in frontmatter as a dead link
    let rel: string[] = []
    if (args.rel?.trim()) {
      const store = await MarkdownStore.buildFromAll()
      const requested = args.rel
        .split(';')
        .map((r) => r.trim())
        .filter(Boolean)
      rel = requested.filter((r) => store.canResolve(r))
      const dropped = requested.filter((r) => !store.canResolve(r))
      if (dropped.length > 0) {
        output.log(colors.yellow(`Dropped unresolvable rel references: ${dropped.join(', ')}`))
      }
    }

    let written
    try {
      written = await writeStreak({
        name: finalName,
        title,
        schedule,
        start,
        end,
        why,
        details: args.details,
        tags,
        rel,
        now,
        category,
      })
    } catch (err) {
      if (err instanceof SlugCollisionError || err instanceof TitleCollisionError) {
        return CommandResult.fail(`${err.message} — pass a different name or title.`)
      }
      throw err
    }

    output.log(colors.green(`Created streak: ${written.file}`))
    if (written.stamped) {
      output.log(colors.gray(`Stamped "${title}" into the ${start.ymd} Streaks list`))
    }
    if (written.dayItemWarning) {
      output.log(colors.yellow(`Warning: Could not add day item: ${written.dayItemWarning}`))
    }

    try {
      openEditor([{ file: written.file }])
      await delay(500)
    } catch {
      // Editor opening is best-effort
    }

    return CommandResult.success({
      file: written.file,
      name: finalName,
      dayItem: written.dayItem,
      stamped: written.stamped,
    })
  }
}
