import * as path from 'node:path'
import { move } from '#lib/fs/mod.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { mkdir } from 'node:fs/promises'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { slugify } from '#lib/string/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { fetchOpenProjectDirs } from '#lib/notebook/projects.ts'
import ProjectDocument from '#shared/models/Project/mod.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

// TODO: consider a sub-folder flag
// like '--sub-folder' or something similar
// useful for monthly projects like Board-Update-September would go in 2023/completed/Board-Updates

const PROJECT_STATUS = ['canceled', 'completed'] as const
type ProjectStatus = (typeof PROJECT_STATUS)[number]

const params = {
  name: ArgOrFlag.string('Project name', { short: 'n', required: true }),
  status: Flag.string('Status: canceled or completed', { short: 's', required: true }),
  reason: Flag.string('Optional reason for closing the project', { short: 'r' }),
  when: Flag.plainDateTime('Date/time in reverse format', {
    default: () => new PlainDateTime(),
  }),
  category: Flag.string('Category: "Personal" or "Professional"', {
    short: 'c',
    parse: (val: string) => `${val} Complete`,
    default: () => 'Professional Complete',
  }),
}

type Params = InferParams<typeof params>
type Result = { projectName: string; status: string; from: string; to: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'projects:close': { params: Params; result: Result }
  }
}

export default class ProjectsCloseTask extends Command {
  static override description: CommandDescription = {
    name: 'projects:close',
    description: 'Close project.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { name: projectName, when, status, category, reason } = args

    if (!PROJECT_STATUS.includes(status as ProjectStatus)) {
      const message = `Invalid status '${status}'. Valid: ${PROJECT_STATUS.join(', ')}`
      output.error(message)
      return CommandResult.fail(message)
    }

    const openProjects = await fetchOpenProjectDirs()
    if (!openProjects.has(projectName)) {
      const message = `Project '${projectName}' not found in open projects`
      output.error(message)
      return CommandResult.fail(message)
    }

    const openProjectDir = openProjects.get(projectName)!
    const openProjectDirName = path.basename(openProjectDir)

    const whenPlainDate = when.plainDate
    const year = whenPlainDate.year

    // Update the overview YAML before moving
    const overviewFile = path.join(openProjectDir, '_project', 'overview.md')
    const overviewContents = await readTextFile(overviewFile)
    const doc = ProjectDocument.fromMarkdown(overviewContents)
    const closed = doc.close(status as 'completed' | 'canceled', {
      reason,
      date: when.plainDate,
    })

    await writeTextFile(overviewFile, closed.toMarkdown())

    // Move to destination
    const destStatusProjects = path.join(config.DIR_PROJECTS as string, status, String(year))

    await mkdir(destStatusProjects, { recursive: true })

    const projectSlug = slugify(projectName, { preserveCase: true })
    const entryWhen = when.time

    const projectDestDir = path.join(destStatusProjects, openProjectDirName)

    await move(openProjectDir, projectDestDir)

    const statusText = reason ? `${status} | ${reason}` : status
    const dayItem = `${entryWhen} > projects/${projectSlug} -> ${statusText}`
    await writeDayItems(whenPlainDate, category, dayItem)

    output.log(`Successfully closed ${projectName} to "${status}".`)

    return CommandResult.success({
      projectName,
      status,
      from: openProjectDir,
      to: projectDestDir,
    })
  }
}
