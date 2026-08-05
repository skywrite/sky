import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { Command, CommandResult } from '#commands/mod.ts'
import { listModels } from '#shared/ai/llm/ollama/listModels.ts'

export default class AiOllamaModelsTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:ollama:models',
    description: 'List Ollama models.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { output } = context
    const models = await listModels()

    output.log('Available Ollama models:')
    models.forEach((model) => output.log(`  - ${model}`))

    return CommandResult.success({ models })
  }
}
