import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import * as openai from '#shared/ai/llm/openai/mod.ts'

const params = {
  prompt: Arg.string('The prompt to send to OpenAI'),
  model: Flag.string('Model to use (default: gpt-4o)'),
  maxTokens: Flag.number('Maximum tokens to generate (default: 16384)'),
  json: Flag.boolean('Enable JSON mode', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { response: string }

export default class AiOpenaiPromptTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:openai:prompt',
    description: 'Send a prompt to OpenAI and get response',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { prompt, model, maxTokens, json } = args

    const response = await openai.prompt({
      prompt,
      model,
      maxTokens,
      jsonMode: json,
    })

    output.log(response)

    return CommandResult.success({ response })
  }
}
