import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { listModels } from '#shared/ai/llm/lm-studio/listModels.ts'

export default class AiLmStudioModelsTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:lm-studio:models',
    description: 'List LM Studio models.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { output } = context
    const models = await listModels()

    output.log('Available LM Studio models:')
    models.forEach((model) => output.log(`  - ${model}`))

    return CommandResult.success({ models })
  }
}
