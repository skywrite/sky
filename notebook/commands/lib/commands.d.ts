/** Parsed CLI arguments (compatible with mri/minimist) */
export interface Args {
  _: string[]
  [key: string]: unknown
}
import type CommandContext from './core/CommandContext.ts'
import type { ParamsRecord } from './params.ts'

export interface CommandArgs<T = Record<string, any>> {
  /**
   * Transformed CLI arguments for this specific task.
   * Contains both positional args and flags, parsed and typed.
   *
   * For typed params, use: CommandArgs<InferParams<typeof params>>
   */
  args: T

  /**
   * Command execution context containing environment information.
   * Includes: platform, config, env, and output handler.
   *
   * @example
   * const { context } = commandArgs
   * if (context.platform === CommandPlatform.Test) {
   *   // Skip external API calls in tests
   * }
   * context.output.log('Command running...')
   */
  context: CommandContext

  /**
   * Command composition service for running other commands.
   *
   * Provides methods for executing subtasks with clean composition:
   * - run() - Execute a single task
   * - runParallel() - Execute multiple tasks concurrently
   * - runSequential() - Execute tasks in sequence (stop on failure)
   *
   * @example
   * ```typescript
   * // Run a single subtask
   * await tasks.run('util:location', { mobile: false })
   *
   * // Run multiple tasks in parallel
   * await tasks.runParallel([
   *   ['prices:fetch-crypto'],
   *   ['util:weather', { detailed: true }],
   * ])
   *
   * // Run tasks sequentially (stops on first failure)
   * await tasks.runSequential([
   *   ['data:validate'],
   *   ['data:transform'],
   *   ['data:load'],
   * ])
   * ```
   */
  tasks: import('./core/CommandService.ts').default

  /**
   * Raw CLI arguments from the parser.
   * Use args for the transformed version.
   */
  rawArgs: Args
}

export type CommandDescriptionCliPostProcessFunction = (
  result: Record<string, any>,
  rawArgs: Args,
  commandDesc: CommandDescription,
) => string | undefined

export interface CommandDescription {
  name: string
  description: string
  descriptionLong?: string[]
  usage?: string[]

  /** Object-based params with Zod types */
  params?: ParamsRecord

  postProcess?: CommandDescriptionCliPostProcessFunction[]
}

// Re-export CommandResult from its dedicated module
export { CommandResult, isError, isFail, isFailOrError, isSuccess } from './core/CommandResult.ts'
import type { CommandResult as TResult } from './core/CommandResult.ts'

// Define the standard task function signature
export type CommandFunction = (args: CommandArgs) => TResult | Promise<TResult>
