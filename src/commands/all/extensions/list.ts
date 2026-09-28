import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { listInstalled } from '#lib/extensions/mod.ts'

type Row = {
  extension: string
  on: string
  version: string
  name: string
  categories: string
  from: string
  problem: string
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'extensions:list': { params: Record<string, never>; result: Row[] }
  }
}

export default class ExtensionsListTask extends Command {
  static override description: CommandDescription = {
    name: 'extensions:list',
    description: 'List installed extensions.',
    usage: ['sky extensions:list'],
  }

  async run({ context }: CommandArgs): Promise<CommandResult<Row[]>> {
    const { output } = context
    const rows: Row[] = (await listInstalled()).map((e) => ({
      extension: e.id,
      on: e.enabled ? 'on' : 'off',
      version: e.manifest.version,
      name: e.manifest.sky.name,
      categories: e.manifest.sky.categories.join(', '),
      from: e.linkedFrom ?? e.dir,
      problem: e.problem ?? '',
    }))
    if (rows.length === 0) output.log('No extensions installed. Add one: sky extensions:add <folder>')
    else output.table(rows)
    return CommandResult.success(rows)
  }
}
