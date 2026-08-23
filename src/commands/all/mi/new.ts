import * as path from 'node:path'
import colors from 'picocolors'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { autoRelMessage } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import openEditor from '#lib/shell/openEditor.ts'
import slugify from '#lib/string/slugify.ts'
import readDir from '#shared/fs/readDir.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import MostImportant from '#shared/models/MostImportant/mod.ts'
import { dayDir, fetchNowSync, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { suggestMostImportant } from './_lib/suggestMostImportant.ts'

/** Corpus framing for enriching an MI: self-authored with no counterparty,
 * like a journal entry, so the journal archive carries the tag vocabulary.
 * A single focused action warrants fewer tags than a journal's five. */
const MI_ENRICH: { mediums: string[]; kind: string; maxTags: number } = {
  mediums: ['journal'],
  kind: 'most important item (daily focus)',
  maxTags: 3,
}

const params = {
  summary: ArgOrFlag.string('Summary of the most important task', { short: 's' }),
  ai: Flag.bool('Use AI to suggest the most important thing', {
    default: false,
  }),
  dryRun: Flag.bool('Show AI suggestion without creating file', {
    default: false,
  }),
  inspect: Flag.bool('Open the AI prompt in VSCode without calling AI', {
    default: false,
  }),
  depend: Flag.bool('Add questions about depending upon others', {
    short: 'd',
    default: false,
  }),
  when: Flag.plainDateTime('When to create the MI for', {
    short: 'w',
    default: () => fetchNowSync().plainDateTime,
  }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-journal tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel proposals from the entity graph', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { file: string; count: number }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'mi:new': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class MiNewTask extends Command {
  static override description: CommandDescription = {
    name: 'mi:new',
    description: 'Create Most Important file.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { when, depend, summary: providedSummary, ai, dryRun, inspect, noAutoTag, noAutoRel } = args

    const whenDay = when.plainDate

    // Get summary from AI if --ai flag is set and no summary provided
    let summary = providedSummary
    let aiMarkdown = ''
    let aiDueBy: string | undefined
    if (ai && !summary) {
      const aiResult = await suggestMostImportant({
        context,
        today: whenDay,
        time: when.time,
        dryRun,
        inspect,
        depend,
      })

      summary = aiResult.summary
      aiMarkdown = aiResult.markdown
      aiDueBy = aiResult.dueBy

      if (inspect) {
        return CommandResult.success({ file: '', count: 0 })
      }

      if (dryRun) {
        output.log(`\n${colors.dim('(dry-run: no file created)')}`)
        return CommandResult.success({ file: '', count: 0 })
      }

      // User cancelled selection
      if (!summary) {
        return CommandResult.success({ file: '', count: 0 })
      }

      output.log(`\nMI: "${summary}"`)
    }

    const miDir = path.join(<string>config.DIR_TIME, dayDir(whenDay), 'most-important')

    let count = 1
    try {
      const iter = readDir(miDir)
      const files = await Array.fromAsync(iter)
      count = files.length + 1
    } catch (_e) {
      // dir doesn't exist - intentionally ignored
    }

    const ddfw = new DayDirFileWriter(whenDay)

    let markdown = aiMarkdown || MostImportant.create(whenDay, { count, dependQuestions: depend, summary }).toMarkdown()

    // Enrich (tags, rel) when there's a summary to work from — a blank
    // questionnaire has nothing to classify. Both helpers abstain on failure.
    if (summary && !(noAutoTag && noAutoRel)) {
      output.log('Enriching (tags, rel)...')
      const doc = Document.fromMarkdown(markdown)
      const enrichInput = { summary, body: doc.markdown }
      const [autoTags, autoRel] = await Promise.all([
        noAutoTag ? undefined : autoTagMessage(enrichInput, MI_ENRICH),
        noAutoRel ? undefined : autoRelMessage(enrichInput, MI_ENRICH),
      ])
      if (autoTags) {
        doc.yaml['tags'] = autoTags
        output.log(`  Auto-tags: ${autoTags}`)
      }
      if (autoRel) {
        doc.yaml['rel'] = autoRel
        output.log(`  Rel: ${autoRel.join(', ')}`)
      }
      if (autoTags || autoRel) markdown = doc.toMarkdown()
    }

    // Filename carries the summary as a slug (MI2_Ship-Docs-Redline.md) so the
    // day's commitments read from a directory listing; blank MIs stay MIn.md.
    const slug = summary ? slugify(summary, { suggestedLength: 40, preserveCase: true }) : ''
    const fileName = slug ? `MI${count}_${slug}.md` : `MI${count}.md`
    const filePath = await ddfw.write(`most-important/${fileName}`, markdown)

    if (summary) {
      const entryTime = aiDueBy || when.time
      const dayItem = `${entryTime} > MI/${count} -> [${summary}](most-important/${path.basename(filePath)})`
      let dayObj = await readDay(whenDay)
      dayObj = dayObj.addMostImportantItem(dayItem)
      await writeDay(dayObj)
    }

    openEditor([{ file: path.join(ddfw.fullDir, filePath), line: 13 }])

    output.log(`\n  Successfully created ${filePath}.\n`)

    return CommandResult.success({ file: filePath, count })
  }
}
