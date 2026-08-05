/**
 * Process an async generator that yields Prompts
 *
 * Iterates through the generator, collecting user input for each prompt
 * using @clack/prompts, and sending responses back via generator.next().
 */

import * as p from '@clack/prompts'
import type { CommandResult } from './CommandResult.ts'
import type { Prompt } from './Prompt.ts'

/**
 * Process prompts from an async generator and return the final result
 *
 * @param gen - Async generator that yields Prompt objects
 * @returns The final CommandResult when the generator completes
 */
export async function processPrompts<T>(
  gen: AsyncGenerator<Prompt, CommandResult<T>, string>,
): Promise<CommandResult<T>> {
  let response = ''

  while (true) {
    const { value, done } = await gen.next(response)

    if (done) {
      return value as CommandResult<T>
    }

    const prompt = value as Prompt
    response = await collectPromptInput(prompt)

    // Handle cancellation
    if (p.isCancel(response)) {
      // Return the generator to allow cleanup
      await gen.return(undefined as unknown as CommandResult<T>)
      return { status: 'fail', message: 'Cancelled by user' } as CommandResult<T>
    }
  }
}

/**
 * Collect input for a single prompt using @clack/prompts
 */
async function collectPromptInput(prompt: Prompt): Promise<string> {
  switch (prompt.type) {
    case 'text': {
      const result = await p.text({
        message: prompt.message,
        defaultValue: prompt.default,
        placeholder: prompt.placeholder,
      })
      return String(result ?? '')
    }

    case 'select': {
      const result = await p.select({
        message: prompt.message,
        options: prompt.options,
        initialValue: prompt.default,
      })
      return String(result ?? '')
    }

    case 'confirm': {
      const result = await p.confirm({
        message: prompt.message,
        initialValue: prompt.default,
      })
      return result ? 'yes' : 'no'
    }
  }
}
