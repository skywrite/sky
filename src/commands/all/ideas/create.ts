import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { categoryComplete, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { SlugCollisionError, writeIdea } from './lib/write.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  title: Flag.string('Idea title (no "Idea:" prefix)', { required: true }),
  body: Flag.string('Markdown body: what it is, why it matters, what it might look like — from ideas_clarify', {
    required: true,
  }),
  name: Flag.string('Slug override (otherwise derived from the title)', { short: 'n', optional: true }),
  tags: Flag.string('Comma- or semicolon-separated tags; omit unless the user named some', { optional: true }),
  rel: Flag.string('Semicolon-separated notebook references, from ideas_clarify', { optional: true }),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { file: string; name: string; dayItem: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ideas:create': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

@AIChatTool({ needsApproval: true })
export default class IdeasCreateTask extends Command {
  static override description: CommandDescription = {
    name: 'ideas:create',
    description:
      'Write an idea document into the notebook (draft/) plus its day item. Headless — pass fields produced by ideas_clarify; the user approves before anything is written.',
    descriptionLong: [
      'Creates the Idea document and day item exactly as ideas:new would,',
      'from explicit fields. No AI calls — pure write.',
    ],
    usage: ['sky ideas:create --title "..." --body "..."'],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    output.log(`  Idea:     ${String(input.title ?? '')}`)
    if (input.tags) output.log(`  Tags:     ${String(input.tags)}`)
    if (input.rel) output.log(`  Rel:      ${String(input.rel)}`)
    output.log(`  Category: ${input.category ? String(input.category) : 'Professional Complete'}`)
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { title, name, category } = args

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

    const now = await fetchNow()

    let written
    try {
      written = await writeIdea({
        name: finalName,
        title,
        body: args.body,
        tags,
        rel,
        now,
        category,
      })
    } catch (err) {
      if (err instanceof SlugCollisionError) {
        return CommandResult.fail(`${err.message} — pass a different name.`)
      }
      throw err
    }

    output.log(colors.green(`Created idea: ${written.file}`))
    if (written.dayItemWarning) {
      output.log(colors.yellow(`Warning: Could not add day item: ${written.dayItemWarning}`))
    }

    return CommandResult.success({ file: written.file, name: finalName, dayItem: written.dayItem })
  }
}
