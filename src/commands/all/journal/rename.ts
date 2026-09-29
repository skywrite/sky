import * as path from 'node:path'
import { Command, CommandResult, dayNoFutureArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { DIR_TIME } from '#shared/config.ts'
import { readDir, readTextFile, rename, writeTextFile } from '#shared/fs/mod.ts'
import JournalDocument from '#shared/models/Journal/document/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { summarizeJournals } from './lib/summaries.ts'

const params = {
  day: dayNoFutureArg(),
  dryRun: Flag.bool('Preview renames without executing', { short: 'd', default: false }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'journal:rename': { params: Params; result: undefined }
  }
}

interface JournalFile {
  fileName: string
  baseName: string
  content: string
}

export default class JournalRenameTask extends Command {
  static override description: CommandDescription = {
    name: 'journal:rename',
    description: 'Rename journal files with AI-generated summaries.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const { day, dryRun } = args

    const journalDir = path.join(DIR_TIME, dayDir(day), 'journal')

    // Collect journal files that need renaming
    const journals: JournalFile[] = []
    for await (const entry of readDir(journalDir)) {
      if (!entry.isFile || !entry.name.endsWith('.md')) continue

      const content = await readTextFile(path.join(journalDir, entry.name))
      const doc = JournalDocument.fromMarkdown(content)
      if (doc.yaml['summary']) continue // already renamed
      if (!hasBody(doc)) continue // empty or unanswered questionnaire — nothing to summarize

      journals.push({
        fileName: entry.name,
        baseName: entry.name.replace('.md', ''),
        content,
      })
    }

    if (journals.length === 0) {
      output.log('No journals to rename.')
      return CommandResult.success()
    }

    output.log(`Generating summaries for ${journals.length} journal(s)...`)

    const summaries = await summarizeJournals(journals, context.signal)

    for (const { fileName, summary } of summaries) {
      const journal = journals.find((j) => j.fileName === fileName)
      if (!journal) continue

      const slug = slugify(summary, { preserveCase: true })
      const newName = `${journal.baseName}_${slug}.md`

      if (dryRun) {
        output.log(`  ${fileName} -> ${newName}`)
      } else {
        // Insert summary into YAML frontmatter
        const doc = JournalDocument.fromMarkdown(journal.content)
        const updated = doc.updateYaml({ summary })
        await writeTextFile(path.join(journalDir, fileName), updated.toMarkdown())

        await rename(path.join(journalDir, fileName), path.join(journalDir, newName))
        output.log(`  ${fileName} -> ${newName}`)
      }
    }

    return CommandResult.success()
  }
}

/** Any non-heading text counts as content — prose entries and answered questions alike. */
function hasBody(doc: JournalDocument): boolean {
  return doc.markdown
    .split('\n')
    .filter((line) => !/^#{1,6}\s/.test(line.trim()))
    .some((line) => line.trim() !== '')
}
