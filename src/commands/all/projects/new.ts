import * as path from 'node:path'
import { Arg, categoryComplete, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { slugify } from '#lib/string/mod.ts'
import { exists, outputFile } from '#shared/fs/mod.ts'
import ProjectDocument from '#shared/models/Project/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  name: Arg.string('Project name'),
  dir: Flag.string('Project directory (defaults to slugified name)', {
    short: 'd',
    optional: true,
  }),
  when: whenNBTime(),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { filePath: string; projectSlug: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'projects:new': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class ProjectsNewTask extends Command {
  static override description: CommandDescription = {
    name: 'projects:new',
    description: 'Create new project.',
    usage: [
      'sky projects:new "My Project"           # Create with default settings',
      'sky projects:new "My Project" -d sub/dir # Custom directory',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { name: projectName, when, dir, category } = args

    const projectSlug = slugify(projectName, { preserveCase: true })

    const projectDir = dir
      ? path.join(config.DIR_PROJECTS_OPEN as string, dir)
      : path.join(config.DIR_PROJECTS_OPEN as string, projectSlug)

    const projectDataDir = path.join(projectDir, '_project')
    const projectOverviewFile = path.join(projectDataDir, 'overview.md')

    if (await exists(projectOverviewFile)) {
      return CommandResult.fail(
        `A project overview already exists: ${projectOverviewFile} — pick a different name or --dir.`,
      )
    }

    const doc = ProjectDocument.create({ name: projectSlug })

    await outputFile(projectOverviewFile, doc.toMarkdown())

    const dayItem = `${when.time} > projects/${projectSlug} -> Created`
    await writeDayItems(when.plainDate, category, dayItem)

    await openEditor([{ file: projectOverviewFile, line: 0 }])

    output.log(`\n  Successfully created ${projectOverviewFile}.\n`)

    return CommandResult.success({ filePath: projectOverviewFile, projectSlug })
  }
}
