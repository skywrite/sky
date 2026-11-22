import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { categoryComplete, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { fetchNow, readDay } from '#shared/nbfs/mod.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { isParseableTarget, parseDecisionMoment, SlugCollisionError, writeDecision } from './lib/write.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  title: Flag.string('Decision title (no "Whether to" prefix)', { required: true }),
  context: Flag.string('Markdown narrative of the decision context — short paragraphs, from decisions_clarify', {
    required: true,
  }),
  desiredOutcomes: Flag.string('Markdown narrative of the desired outcomes, from decisions_clarify', {
    required: true,
  }),
  decision: Flag.string(
    'The decision as made — pass when the call is already settled; the document lands resolved with this in its Decision section. Omit for a still-open decision.',
    { optional: true },
  ),
  inForce: Flag.bool(
    'Pass true when the made decision keeps binding what the person does — a rule, a freeze, a quit ("no X until Y") — instead of being carried out once. It lands in in-force/ and stays in view in every chat until it ends or is retired. Needs `decision`; say what ends it, if anything, in the decision text.',
    { default: false },
  ),
  when: Flag.string(
    'When the decision was actually made (or, for an open one, first came up), if that was not just now: "YYYY-MM-DD HH:MM", or "YYYY-MM-DD" when the notebook shows no time. For anything decided before today, find the moment in the notebook first (journal entries, chats, day files) and pass it; never leave an older decision dated today. The document is dated, filed and logged on that day.',
    { short: 'w', optional: true },
  ),
  target: Flag.string('Decide-by date for a still-open decision: "YYYY-MM-DD" or "YYYY-MM-DD HH:MM"', {
    optional: true,
  }),
  name: Flag.string('Slug override (otherwise derived from the title)', { short: 'n', optional: true }),
  tags: Flag.string('Comma- or semicolon-separated tags; omit unless the user named some', { optional: true }),
  rel: Flag.string('Semicolon-separated notebook references, from decisions_clarify', { optional: true }),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { file: string; name: string; dayItem: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'decisions:create': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

@AIChatTool({ needsApproval: true })
export default class DecisionsCreateTask extends Command {
  static override description: CommandDescription = {
    name: 'decisions:create',
    description:
      'Write a decision document into the notebook plus its day item — pending/ for an open decision, resolved/ when `decision` carries the call already made, in-force/ when `inForce` says that made call still binds what the person does. Headless — pass fields produced by decisions_clarify; the user approves before anything is written.',
    descriptionLong: [
      'Creates the Decision document and day item exactly as decisions:new',
      'would, from explicit fields. No AI calls — pure write.',
    ],
    usage: [
      'sky decisions:create --title "..." --context "..." --desired-outcomes "..."',
      'sky decisions:create --title "..." --context "..." --desired-outcomes "..." --decision "..." --in-force',
      'sky decisions:create --title "..." --context "..." --desired-outcomes "..." --decision "..." --when "2026-01-20 14:00"',
    ],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    output.log(`  Decision: ${String(input.title ?? '')}`)
    const landing = input.inForce ? 'decided and in force — lands in in-force/' : 'decided — lands in resolved/'
    output.log(`  Status:   ${input.decision ? landing : 'pending'}`)
    if (input.decision) output.log(`  The call: ${String(input.decision)}`)
    if (input.when) output.log(`  When:     ${String(input.when)}`)
    if (input.target) output.log(`  Target:   ${String(input.target)}`)
    if (input.tags) output.log(`  Tags:     ${String(input.tags)}`)
    if (input.rel) output.log(`  Rel:      ${String(input.rel)}`)
    output.log(`  Category: ${input.category ? String(input.category) : 'Professional Complete'}`)
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { title, name, category } = args
    const decision = args.decision?.trim() || undefined
    if (args.inForce && !decision) {
      return CommandResult.fail(
        'A decision can only be in force once it is made — pass decision with what was decided.',
      )
    }

    let target = args.target
    if (decision && target) {
      // A made decision has no decide-by date — execution dates live in the narrative
      output.log(colors.dim(`Ignoring target "${target}" — the decision is already made.`))
      target = undefined
    }
    if (target && !isParseableTarget(target)) {
      return CommandResult.fail(`Target "${target}" is not "YYYY-MM-DD" or "YYYY-MM-DD HH:MM"`)
    }

    const finalName =
      (name ? slugify(name, { preserveCase: true }) : '') || slugify(title, { suggestedLength: 25, preserveCase: true })

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

    // A decision made earlier is dated, filed and logged on the day it was made
    const today = await fetchNow()
    let now = today
    if (args.when?.trim()) {
      const moment = parseDecisionMoment(args.when)
      if (!moment) {
        return CommandResult.fail(`When "${args.when}" is not "YYYY-MM-DD" or "YYYY-MM-DD HH:MM"`)
      }
      if (moment.plainDate.ymd > today.plainDateTime.plainDate.ymd) {
        return CommandResult.fail(`When "${args.when}" has not happened yet — leave it out for a decision made now.`)
      }
      // That day's own timezone, as decisions:resolve --when uses; a day with no file takes today's
      let timezone = today.timezone
      try {
        timezone = (await readDay(moment.plainDate)).timezone
      } catch {
        // No day file for that date
      }
      now = new ZonedDateTime(moment, timezone)
    }

    let written
    try {
      written = await writeDecision({
        name: finalName,
        title,
        context: args.context,
        desiredOutcomes: args.desiredOutcomes,
        target,
        decision,
        inForce: args.inForce,
        tags,
        rel,
        now,
        recorded: today.plainDateTime.plainDate,
        category,
      })
    } catch (err) {
      if (err instanceof SlugCollisionError) {
        return CommandResult.fail(`${err.message} — pass a different name.`)
      }
      throw err
    }

    output.log(colors.green(`Created decision: ${written.file}`))
    if (written.dayItemWarning) {
      output.log(colors.yellow(`Warning: Could not add day item: ${written.dayItemWarning}`))
    }

    try {
      openEditor([{ file: written.file, line: written.markdown.split('\n').length }])
      await delay(500)
    } catch {
      // Editor opening is best-effort
    }

    return CommandResult.success({ file: written.file, name: finalName, dayItem: written.dayItem })
  }
}
