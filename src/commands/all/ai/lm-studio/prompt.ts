import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import * as lmStudio from '#shared/ai/llm/lm-studio/mod.ts'

const params = {
  prompt: Arg.string('The prompt to send to the model'),
  model: Flag.string(`Model to use (default: ${lmStudio.DEFAULT_MODEL})`),
  temperature: Flag.number('Temperature for generation (0-2, default: 0)'),
  maxTokens: Flag.number('Maximum tokens to generate (default: 2000)'),
  system: Flag.string('System prompt to use'),
}

type Params = InferParams<typeof params>
type Result = { response: string }

export default class AiLmStudioPromptTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:lm-studio:prompt',
    description: 'Prompt LM Studio local model',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { prompt, model, temperature, maxTokens, system } = args

    const response = await lmStudio.prompt({
      prompt,
      model,
      temperature,
      maxTokens,
      system,
    })

    output.log(response)
    return CommandResult.success({ response })
  }
}
