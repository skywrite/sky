import colors from 'picocolors'
import { commandDescriptionToSchema } from '#commands/lib/jsonSchema.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { discoverAIChatTools } from './_tools.ts'

const params = {
  schema: Flag.boolean('Show full JSON Schema for each tool', { default: false }),
}

type Params = InferParams<typeof params>

export default class AiChatToolsTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:chat:tools',
    description: 'List available AI chat tools.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context
    const tools = await discoverAIChatTools()

    if (tools.length === 0) {
      output.log('No @AIChatTool decorated tasks found.')
      return CommandResult.success()
    }

    output.log(colors.bold(`${tools.length} AI chat tool${tools.length > 1 ? 's' : ''}:\n`))

    for (const t of tools) {
      const approval = t.needsApproval ? colors.yellow('approval') : colors.green('auto')
      output.log(`  ${colors.bold(t.toolName)} ${colors.dim(`(${t.commandName})`)} [${approval}]`)
      output.log(`  ${colors.dim(t.description)}`)

      if (args.schema) {
        const schema = commandDescriptionToSchema(t.commandClass.description)
        const json = JSON.stringify(schema, null, 2)
          .split('\n')
          .map((l) => '    ' + l)
          .join('\n')
        output.log(colors.dim(json))
      }

      output.log('')
    }

    return CommandResult.success()
  }
}
