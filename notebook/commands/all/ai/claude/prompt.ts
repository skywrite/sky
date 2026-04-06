import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import * as claude from '#shared/ai/llm/claude/mod.ts'

const params = {
  prompt: Arg.string('The prompt to send to Claude'),
  model: Flag.string('Model to use (default: claude-sonnet-4-5-20250929)'),
  maxTokens: Flag.number('Maximum tokens to generate (default: 64000)'),
  json: Flag.boolean('Enable JSON mode (strips markdown code fences)', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { response: string }

export default class AiClaudePromptTask extends Command {
  static override description: CommandDescription = {
    name: 'ai:claude:prompt',
    description: 'Send a prompt to Claude and get response',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { prompt, model, maxTokens, json } = args

    const response = await claude.prompt({
      prompt,
      model,
      maxTokens,
      jsonMode: json,
    })

    output.log(response)

    return CommandResult.success({ response })
  }
}
