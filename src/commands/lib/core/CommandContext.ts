import { ClackPrompter } from '#commands/lib/prompt/ClackPrompter.ts'
import type { Prompter } from '#commands/lib/prompt/Prompter.ts'
import { UnattendedPrompter } from '#commands/lib/prompt/UnattendedPrompter.ts'
import type * as ConfigModule from '#config'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { BufferedOutput } from '../output/BufferedOutput.ts'
import { ConsoleOutput } from '../output/ConsoleOutput.ts'
import type { OutputHandler } from '../output/OutputHandler.ts'

/**
 * Platform where the task is executing
 */
export enum CommandPlatform {
  /** Command-line interface */
  Console = 'console',
  /** VSCode extension */
  VSCode = 'vscode',
  /** Server/API environment */
  Server = 'server',
  /** Test environment */
  Test = 'test',
}

/**
 * Options for creating a CommandContext
 */
export interface CommandContextOptions {
  platform: CommandPlatform
  config: typeof ConfigModule
  env: Record<string, string>
  output: OutputHandler
  /**
   * Notebook time - the current time in the notebook's concept of "now".
   * This can differ from system time because notebook days can extend past midnight.
   * For example, at 2 AM system time, notebook time might be "26:00" of the previous day.
   */
  notebookNow?: ZonedDateTime
  /**
   * Lazy notebook time provider. CLI/server contexts use this so commands that
   * do not need notebook time can still run when no notebook day is started.
   */
  notebookNowProvider?: () => ZonedDateTime
  /**
   * System/wall-clock time - the actual current time from the system clock.
   */
  systemNow: ZonedDateTime
  /**
   * How deeply nested this task is in the composition tree.
   * 0 = root task (run directly from CLI), 1+ = composed (called by another task).
   *
   * Use `context.compositionDepth === 0` to check if running from CLI vs composed.
   */
  compositionDepth?: number
  /**
   * Name of the parent task that invoked this task, if any.
   * undefined for root tasks (run directly from CLI).
   *
   * Useful for logging/tracing to see the call chain.
   */
  parentTaskName?: string
  /**
   * Provider for accessing secrets stored in the OS keychain.
   * Use this instead of storing sensitive credentials in .env files.
   */
  secrets?: SecretsProvider
  /**
   * Who answers a command's questions. The terminal answers with prompts;
   * a headless run answers nothing (the default), and says so through
   * `prompt.interactive` so commands take their defaults instead of waiting.
   */
  prompt?: Prompter
  /**
   * Set when the host may cancel the run. Commands pass it to what they
   * await and check it between steps; a headless run without one runs to
   * the end.
   */
  signal?: AbortSignal
}

/**
 * CommandContext represents the execution environment for a task.
 *
 * It contains shared resources that are constant across a task execution tree:
 * - Application configuration
 * - OS environment variables
 * - Output handler for logging
 *
 * CommandContext is immutable - use fork() to create a new context with modifications.
 *
 * ## Future Enhancements
 *
 * When CommandService is implemented, we may add:
 * - `capabilities: { interactive, richFormatting, ... }` - Environment capabilities
 * - `workingDirectory: string` - Current working directory
 * - `metadata: Record<string, unknown>` - Extensible metadata bag
 * - `ui?: { prompt, select, progress, ... }` - Environment-specific UI utilities
 * - `forkWithNestedOutput(commandName)` - Helper for creating child contexts with indentation
 *
 * For now, we keep it simple and focused on the essentials.
 */
export default class CommandContext {
  readonly platform: CommandPlatform
  readonly config: typeof ConfigModule
  readonly env: Record<string, string>
  readonly output: OutputHandler
  private _notebookNow?: ZonedDateTime
  private readonly notebookNowProvider?: () => ZonedDateTime
  /**
   * Notebook time - the current time in the notebook's concept of "now".
   * This can differ from system time because notebook days can extend past midnight.
   */
  get notebookNow(): ZonedDateTime {
    if (!this._notebookNow) {
      if (!this.notebookNowProvider) {
        throw new Error('Unable to compute the current date / time.')
      }
      this._notebookNow = this.notebookNowProvider()
    }
    return this._notebookNow
  }
  /**
   * System/wall-clock time - the actual current time from the system clock.
   */
  readonly systemNow: ZonedDateTime
  /**
   * How deeply nested this task is in the composition tree.
   * 0 = root task (run directly from CLI), 1+ = composed (called by another task).
   *
   * @example
   * if (context.compositionDepth === 0) {
   *   // Running from CLI - print to stdout
   *   output.log(result)
   * }
   * // Else: composed - just return in CommandResult
   */
  readonly compositionDepth: number
  /**
   * Name of the parent task that invoked this task, if any.
   * undefined for root tasks (run directly from CLI).
   *
   * Useful for logging/tracing to see the call chain.
   *
   * @example
   * const caller = context.parentTaskName ?? 'cli'
   * context.output.log(`[${caller}] Gathering context...`)
   */
  readonly parentTaskName?: string
  /**
   * Provider for accessing secrets stored in the OS keychain.
   */
  readonly secrets: SecretsProvider
  /**
   * Who answers a command's questions — the way back in, as `output` is the way out.
   */
  readonly prompt: Prompter
  /**
   * The host's cancel, when it has one.
   */
  readonly signal?: AbortSignal

  constructor(options: CommandContextOptions) {
    this.platform = options.platform
    this.config = options.config
    this.env = options.env
    this.output = options.output
    this._notebookNow = options.notebookNow
    this.notebookNowProvider = options.notebookNowProvider
    this.systemNow = options.systemNow
    this.compositionDepth = options.compositionDepth ?? 0
    this.parentTaskName = options.parentTaskName
    this.secrets = options.secrets ?? new TestSecretsProvider()
    this.prompt = options.prompt ?? new UnattendedPrompter()
    this.signal = options.signal
  }

  /**
   * Create a new CommandContext with some properties overridden.
   *
   * The original context is not modified (immutability).
   *
   * @example
   * const childContext = context.fork({
   *   output: new BufferedOutput()
   * })
   */
  fork(overrides: Partial<CommandContextOptions>): CommandContext {
    return new CommandContext({
      platform: overrides.platform ?? this.platform,
      config: overrides.config ?? this.config,
      env: overrides.env ?? this.env,
      output: overrides.output ?? this.output,
      notebookNow: overrides.notebookNow ?? this._notebookNow,
      notebookNowProvider: overrides.notebookNowProvider ?? this.notebookNowProvider,
      systemNow: overrides.systemNow ?? this.systemNow,
      compositionDepth: overrides.compositionDepth ?? this.compositionDepth,
      parentTaskName: overrides.parentTaskName ?? this.parentTaskName,
      secrets: overrides.secrets ?? this.secrets,
      prompt: overrides.prompt ?? this.prompt,
      signal: overrides.signal ?? this.signal,
    })
  }

  /**
   * Create a console environment (CLI usage)
   *
   * This is the default context for tasks run from the command line.
   * Times are captured at context creation and remain constant throughout execution.
   *
   * @param config - Application configuration
   * @param env - OS environment variables
   * @param commandName - Optional task name for output prefixing
   * @param disablePrefix - Whether to disable task name prefixes (default: true)
   */
  static console(
    config: typeof ConfigModule,
    env: Record<string, string>,
    commandName?: string,
    disablePrefix = true,
    options?: {
      notebookNow?: ZonedDateTime
      notebookNowProvider?: () => ZonedDateTime
    },
  ): CommandContext {
    const systemNow = new ZonedDateTime()
    return new CommandContext({
      platform: CommandPlatform.Console,
      config,
      env,
      output: new ConsoleOutput(commandName, disablePrefix, 0),
      notebookNow: options?.notebookNow,
      notebookNowProvider: options?.notebookNowProvider ?? (() => fetchNowSync({ now: systemNow })),
      systemNow,
      secrets: new KeychainSecretsProvider(),
      prompt: new ClackPrompter(),
    })
  }

  /**
   * Options for creating a test context
   */
  static test(
    config: typeof ConfigModule,
    options?: {
      env?: Record<string, string>
      notebookNow?: ZonedDateTime
      systemNow?: ZonedDateTime
      secrets?: Record<string, import('#lib/secrets/types.ts').SecretEntry>
    },
  ): CommandContext {
    // Default to a fixed time for deterministic tests
    const defaultTime = new ZonedDateTime()
    return new CommandContext({
      platform: CommandPlatform.Test,
      config,
      env: {
        NODE_ENV: 'test',
        ...options?.env,
      },
      output: new BufferedOutput(),
      notebookNow: options?.notebookNow ?? defaultTime,
      systemNow: options?.systemNow ?? defaultTime,
      secrets: new TestSecretsProvider(options?.secrets),
    })
  }

  /**
   * Create a server/API environment
   *
   * Uses BufferedOutput for capturing logs to return in API responses.
   * Times are captured at context creation and remain constant throughout execution.
   *
   * @param config - Application configuration
   * @param env - OS environment variables
   */
  static server(config: typeof ConfigModule, env: Record<string, string>): CommandContext {
    const systemNow = new ZonedDateTime()
    return new CommandContext({
      platform: CommandPlatform.Server,
      config,
      env,
      output: new BufferedOutput(),
      notebookNowProvider: () => fetchNowSync({ now: systemNow }),
      systemNow,
      secrets: new KeychainSecretsProvider(),
    })
  }

  // Future factory methods:
  // - static vscode(config, vscodeApi) - VSCode extension context (CommandPlatform.VSCode)
}
