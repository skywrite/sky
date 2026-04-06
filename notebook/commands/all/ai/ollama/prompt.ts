import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import * as ollama from '#shared/ai/llm/ollama/mod.ts'

const params = {
  prompt: Arg.string('The prompt to send to the model'),
  model: Flag.string('Model to use (default: deepseek-r1:1.5b)'),
  temperature: Flag.number('Temperature for sampling (0-1, default: 0)'),
  maxTokens: Flag.number('Maximum tokens to generate'),
  contextWindow: Flag.number('Context window size in tokens (default: model default)'),
  system: Flag.string('System prompt to use'),
  json: Flag.boolean('Enable JSON mode', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { response: string }

export default class AiOllamaPromptTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:ollama:prompt',
    description: 'Prompt Ollama models',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { prompt, model, temperature, maxTokens, contextWindow, system, json } = args

    const response = await ollama.prompt({
      prompt,
      model,
      temperature,
      maxTokens,
      contextWindow,
      system,
      jsonMode: json,
    })

    output.log(response)
    return CommandResult.success({ response })
  }
}
