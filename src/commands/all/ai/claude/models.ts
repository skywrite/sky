import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { Command, CommandResult } from '#commands/mod.ts'
import { listModels } from '#shared/ai/llm/claude/listModels.ts'

export default class AiClaudeModelsTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:claude:models',
    description: 'List available Claude models',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { output } = context
    const models = await listModels()

    output.log('Available Claude models:')
    for (const model of models) {
      output.log(`  - ${model}`)
    }

    return CommandResult.success({ models })
  }
}
