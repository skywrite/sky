import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { Command, CommandResult } from '#commands/mod.ts'
import { listModels } from '#shared/ai/llm/openai/listModels.ts'

export default class AiOpenaiModelsTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:openai:models',
    description: 'List OpenAI models.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { output } = context
    const models = await listModels()

    output.log('Available OpenAI models:')
    models.forEach((model) => output.log(`  - ${model}`))

    return CommandResult.success({ models })
  }
}
