import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { listModels } from '#shared/ai/llm/mistral/listModels.ts'

export default class AiMistralModelsTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:mistral:models',
    description: 'List Mistral models.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { output } = context
    const models = await listModels()

    output.log('Available Mistral models:')
    models.forEach((model) => output.log(`  - ${model}`))

    return CommandResult.success({ models })
  }
}
