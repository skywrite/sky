import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
// TODO: migrate to use ProjectStore.getOpen() instead of fetchOpenProjectDirs()
import { fetchOpenProjectDirs } from '#lib/notebook/projects.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

type Params = Record<string, never>
type Result = { projects: string[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'projects:list': { params: Params; result: Result }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class ProjectsListTask extends Command {
  static override description: CommandDescription = {
    name: 'projects:list',
    description: 'List open projects.',
  }

  async run({ context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const openProjects = await fetchOpenProjectDirs()
    const sortedNames = [...openProjects.keys()].sort((a, b) => a.localeCompare(b))

    for (const projectName of sortedNames) {
      output.log(projectName)
    }

    return CommandResult.success({ projects: sortedNames })
  }
}
