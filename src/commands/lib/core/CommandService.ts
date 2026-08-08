import colors from 'picocolors'
import { getManifest, type CommandEntry } from '#commands/all/cli/_commandsManifest.ts'
import type { Args } from '#commands/lib/commands.d.ts'
import type { CommandArgs } from '#commands/lib/commands.d.ts'
import transformTypedParamsArgs from '#commands/lib/transformTypedParamsArgs/mod.ts'
import { Command, CommandResult } from '#commands/mod.ts'
import type CommandContext from './CommandContext.ts'
import type { CommandTypesRegistry } from './CommandTypesRegistry.ts'
import type { Prompt } from './Prompt.ts'

/**
 * Shared task class cache (singleton)
 */
const commandCache = new Map<string, typeof Command>()

/** Find a command in the manifest by name (local overrides core) */
async function findCommand(commandName: string): Promise<CommandEntry | null> {
  const manifest = await getManifest()
  for (const source of ['local', 'global', 'core'] as const) {
    const entry = manifest.commands[source].find((c) => c.name === commandName)
    if (entry) return entry
  }
  return null
}

/**
 * CommandService provides task composition and orchestration capabilities.
 *
 * ## Architecture: Scoped Instances (Immutable State)
 *
 * Each CommandService instance represents a "scope" in the task execution tree,
 * similar to a call stack frame. It carries immutable state for its scope:
 * - `context`: The execution context (platform, config, env, output)
 * - `currentArgs`: The merged arguments for this scope
 *
 * When a task runs a subtask via `tasks.run()`, a NEW CommandService instance
 * is created for that subtask with:
 * - Forked context (with nested output)
 * - Merged arguments (parent args + overrides)
 *
 * ## Why Scoped Instances? (Not Singleton)
 *
 * A singleton CommandService with mutable state would break parallel execution:
 *
 * ```typescript
 * // ANTI-PATTERN: Singleton with mutable state
 * class CommandService {
 *   private currentContext: CommandContext  // ← Shared mutable state
 *   private currentArgs: Record<string, unknown>
 *
 *   async run(commandName: string) {
 *     this.currentContext = ...  // ← Race condition!
 *     await asyncWork()
 *     // currentContext might have been changed by parallel task!
 *   }
 * }
 * ```
 *
 * **The Problem: Clobbering**
 *
 * When tasks run in parallel (via `runParallel()`), they would overwrite
 * each other's state:
 *
 * ```
 * Time 0ms:  task A sets currentArgs = { when: '2024-01-15' }
 * Time 5ms:  task B sets currentArgs = { detailed: true }  ← Overwrites A!
 * Time 10ms: task A resumes, reads currentArgs
 *            Gets { detailed: true } instead of { when: '2024-01-15' }
 *            BUG! Wrong arguments!
 * ```
 *
 * **The Solution: Immutable Scoped Instances**
 *
 * Each task execution gets its own CommandService instance with immutable state.
 * Parallel tasks have isolated state that can't interfere:
 *
 * ```
 * serviceA = new CommandService(contextA, { when: '2024-01-15' })
 * serviceB = new CommandService(contextB, { detailed: true })
 *
 * // Both run in parallel, no clobbering possible
 * await Promise.all([
 *   serviceA.run('task1'),  // Uses serviceA's args
 *   serviceB.run('task2'),  // Uses serviceB's args
 * ])
 * ```
 *
 * ## Mental Model: Call Stack Frames
 *
 * Think of CommandService like a call stack frame:
 * - Each function call has its own stack frame
 * - Stack frames have local variables (isolated from other frames)
 * - Nested calls create new stack frames
 * - No frame can mutate another frame's variables
 *
 * ```
 * day:start execution
 *   └─ CommandService { context: A, args: { when: '2024-01-15' } }
 *      │
 *      ├─ calls run('sr-update', { category: 'pending' })
 *      │  └─ Creates: CommandService { context: B, args: { when: '2024-01-15', category: 'pending' } }
 *      │     └─ sr-update execution (isolated state)
 *      │
 *      └─ calls run('weather', { detailed: true })
 *         └─ Creates: CommandService { context: C, args: { when: '2024-01-15', detailed: true } }
 *            └─ weather execution (isolated state)
 * ```
 *
 * ## Performance Notes
 *
 * Creating many CommandService instances is cheap:
 * - No heavy initialization
 * - Just holds references to context and args (already created)
 * - JavaScript engines optimize object creation
 * - Task class cache is shared across all instances
 *
 * The benefits (no mutable state bugs, safe parallelism) far outweigh
 * the minimal cost of instance creation.
 *
 * ## Future: CommandContext.forkWithNestedOutput()
 *
 * The pattern `context.fork({ output: context.output.child(commandName) })`
 * is repeated in run(), runParallel(), and runSequential(). In the future,
 * we might add a convenience method to CommandContext:
 *
 * ```typescript
 * // Proposed future enhancement (not implemented yet)
 * forkWithNestedOutput(commandName: string): CommandContext {
 *   const childOutput = this.output.child?.(commandName) ?? this.output
 *   return this.fork({ output: childOutput })
 * }
 * ```
 *
 * For now, we keep CommandContext minimal and handle this pattern internally.
 */
export default class CommandService {
  readonly context: CommandContext
  private readonly currentArgs: Record<string, unknown>
  private readonly rawArgs: Args
  private readonly currentTaskName?: string

  /**
   * Create a new CommandService for a specific execution scope.
   *
   * @param context - The execution context (platform, config, env, output)
   * @param currentArgs - The merged arguments for this scope (default: {})
   * @param rawArgs - The original CLI arguments (default: minimal Args with empty _)
   * @param currentTaskName - The name of the task this service is attached to (for parentTaskName tracking)
   */
  constructor(
    context: CommandContext,
    currentArgs: Record<string, unknown> = {},
    rawArgs?: Args,
    currentTaskName?: string,
  ) {
    this.context = context
    this.currentArgs = currentArgs
    this.rawArgs = rawArgs ?? { _: [], ...currentArgs }
    this.currentTaskName = currentTaskName
  }

  /**
   * Load a task class by name (with caching).
   *
   * Task classes are loaded from `commands/all/${filePath}.ts` and cached
   * in the shared commandCache for subsequent calls.
   *
   * Task names use colon format (e.g., 'prices:fetch:crypto') which are
   * converted to file paths (e.g., 'prices/fetch-crypto').
   *
   * @param commandName - Task name in colon format (e.g., 'prices:fetch:crypto')
   * @returns The Task class (constructor)
   * @throws Error if task file doesn't exist or doesn't export a Task class
   *
   * @example
   * ```typescript
   * const TaskClass = await tasks.get('prices:fetch:crypto')
   * const description = TaskClass.description
   * const instance = new TaskClass()
   * ```
   */
  async get(commandName: string): Promise<typeof Command> {
    if (commandCache.has(commandName)) {
      return commandCache.get(commandName)!
    }

    // Resolve via manifest (supports core, local, and global commands)
    const entry = await findCommand(commandName)
    if (!entry) {
      throw new Error(`Command '${commandName}' not found. Run 'sky cli:commands --rebuild' to update the manifest.`)
    }

    let commandMod: any
    try {
      commandMod = await import(entry.file)
    } catch (e) {
      throw new Error(`Failed to load command '${commandName}' from ${entry.file}: ${(e as Error).message}`)
    }

    const TaskClass = commandMod.default

    if (!TaskClass || typeof TaskClass !== 'function' || !TaskClass.description) {
      throw new Error(`Command '${commandName}' does not export a Command class as default export`)
    }

    commandCache.set(commandName, TaskClass)
    return TaskClass
  }

  /**
   * Run a single task with optional argument overrides.
   *
   * This method:
   * 1. Loads the task class
   * 2. Merges parent args with overrides
   * 3. Transforms merged args using child task's description
   * 4. Creates child context with nested output
   * 5. Creates child CommandService for subtask
   * 6. Executes the task
   *
   * @param commandName - Task name in format 'category/command'
   * @param argsOverride - Optional argument overrides
   * @returns CommandResult from the executed task
   *
   * @example
   * ```typescript
   * // Run task with parent's args
   * await tasks.run('day:sr-update')
   *
   * // Run task with overrides
   * await tasks.run('day:sr-update', { category: 'pending' })
   *
   * // Type-safe result data (registered task)
   * const result = await tasks.run('slack:new', { to: 'alice' })
   * if (result.ok) {
   *   console.log(result.data.filePath)  // TypeScript knows the type!
   * }
   *
   * // Unregistered task - use generic for result type
   * const result = await tasks.run<LocationData>('util:location')
   * ```
   */
  // Overload 1: Registered task - fully typed params and result.
  // Overrides use the entry's input-side `paramsIn` when declared (params
  // whose write shape is wider than what run() reads, e.g. stringOrBool),
  // falling back to `params`.
  async run<K extends keyof CommandTypesRegistry>(
    commandName: K,
    argsOverride?: CommandTypesRegistry[K] extends { paramsIn: infer I }
      ? Partial<I>
      : Partial<CommandTypesRegistry[K]['params']>,
  ): Promise<CommandResult<CommandTypesRegistry[K]['result']>>

  // Overload 2: Unregistered task - loose typing (backward compat)
  // deno-lint-ignore no-explicit-any
  async run<T = any>(commandName: string, argsOverride?: Record<string, unknown>): Promise<CommandResult<T>>

  // Implementation
  // deno-lint-ignore no-explicit-any
  async run<T = any>(commandName: string, argsOverride?: Record<string, unknown>): Promise<CommandResult<T>> {
    // Load task class
    const TaskClass = await this.get(commandName)
    const commandInstance = new (TaskClass as any)() // Cast to any to handle abstract class
    const commandDescription = TaskClass.description

    // Step 1: Transform parent args using child task's description
    // This applies the child's parse() and default() functions
    const baseArgsForTransform: Args = { _: [], ...this.currentArgs }

    let transformedArgs: Record<string, unknown>
    if (commandDescription?.params) {
      // Include argsOverride so required-param checks see them.
      // Already-parsed objects (PlainDate) skip parsing via needsParsing() check.
      // Pass compositionDepth to suppress unknown-flag warnings for nested task calls.
      const argsWithOverrides: Args = { ...baseArgsForTransform, ...argsOverride }
      transformedArgs = await transformTypedParamsArgs(commandDescription.params, argsWithOverrides, {
        compositionDepth: this.context.compositionDepth + 1,
      })
    } else {
      transformedArgs = this.currentArgs
    }

    // Step 2: Merge transformed args with overrides
    // Overrides are passed through unchanged - parent tasks already have parsed values.
    // Server/MCP handlers should pre-parse values before calling CommandService.
    // Priority: task defaults < parent args < overrides
    const finalArgs = { ...transformedArgs, ...argsOverride }

    // stringOrBool overrides are presence signals, not parsed values — the
    // raw re-spread above would hand run() the caller's boolean (true) where
    // it expects the resolved string, so re-resolve them through the schema
    for (const [name, def] of Object.entries(commandDescription?.params ?? {})) {
      if (def.type === 'stringOrBool' && def.schema && name in finalArgs) {
        const resolved = def.schema.safeParse(finalArgs[name])
        if (resolved.success) finalArgs[name] = resolved.data
      }
    }

    // Step 3: Create child context with nested output and incremented composition depth
    const childOutput = this.context.output.child?.(commandName) ?? this.context.output
    const childContext = this.context.fork({
      output: childOutput,
      compositionDepth: this.context.compositionDepth + 1,
      parentTaskName: this.currentTaskName,
    })

    // Step 4: Create child CommandService for subtask
    // The child service carries the final merged args for its own subtasks
    // Pass commandName as currentTaskName so grandchildren know their parent
    const childService = new CommandService(childContext, finalArgs, this.rawArgs, commandName)

    // Step 5: Create CommandArgs for child task
    const commandArgs: CommandArgs = {
      args: finalArgs,
      context: childContext,
      tasks: childService,
      rawArgs: this.rawArgs,
    }

    // Step 6: Execute task
    const result = await commandInstance.run(commandArgs)

    return result as CommandResult<T>
  }

  /**
   * Run multiple tasks in parallel.
   *
   * All tasks are started simultaneously and executed in parallel.
   * All tasks complete (wait-all) even if some fail - no fail-fast behavior.
   *
   * This is useful for independent operations that can run concurrently:
   * - Fetching data from multiple APIs
   * - Running independent validation checks
   * - Initializing multiple resources
   *
   * @param tasks - Array of [commandName, args?] tuples
   * @returns Array of CommandResults (one per task, in same order)
   *
   * @example
   * ```typescript
   * const results = await tasks.runParallel([
   *   ['prices:fetch-crypto'],
   *   ['util:weather', { detailed: true }],
   *   ['util:location', { mobile: false }],
   * ])
   *
   * // Check for failures
   * const failures = results.filter(r => r.status !== 'success')
   * if (failures.length > 0) {
   *   return CommandResult.fail('Some tasks failed')
   * }
   * ```
   */
  async runParallel(tasks: Array<[string, Record<string, unknown>?]>): Promise<CommandResult[]> {
    const promises = tasks.map(([commandName, args]) => this.run(commandName, args))

    // Wait for all tasks to complete (no fail-fast)
    // This ensures all async operations finish cleanly
    return await Promise.all(promises)
  }

  /**
   * Run multiple tasks sequentially, stopping on first failure.
   *
   * Tasks are executed one after another in order. If any task fails
   * (status !== 'success'), execution stops immediately and returns
   * that failure result.
   *
   * This is useful for dependent operations that must succeed in order:
   * - Data pipeline (validate → transform → load)
   * - Multi-step processes (setup → execute → cleanup)
   * - Sequential file operations
   *
   * @param tasks - Array of [commandName, args?] tuples
   * @returns CommandResult - First failure, or success if all succeed
   *
   * @example
   * ```typescript
   * // Runs in order, stops on first failure
   * const result = await tasks.runSequential([
   *   ['data:validate'],
   *   ['data:transform'],  // Only runs if validate succeeds
   *   ['data:load'],       // Only runs if transform succeeds
   * ])
   *
   * if (result.status !== 'success') {
   *   // One of the tasks failed
   *   return result
   * }
   * ```
   */
  async runSequential(tasks: Array<[string, Record<string, unknown>?]>): Promise<CommandResult> {
    for (const [commandName, args] of tasks) {
      const result = await this.run(commandName, args)

      // Stop on first failure
      if (result.status !== 'success') {
        return result
      }
    }

    // All tasks succeeded
    return CommandResult.success()
  }

  /**
   * Run a task's runWithPrompts() generator, yielding prompts for composition.
   *
   * Use this with yield* to forward prompts from subtasks to your caller:
   * ```typescript
   * async *runWithPrompts({ tasks }: CommandArgs) {
   *   const result = yield* tasks.runWithPrompts('journal:me:update')
   *   return CommandResult.success()
   * }
   * ```
   *
   * For non-interactive execution (prompts handled internally), use run() instead.
   *
   * @param commandName - Task name in colon format
   * @param argsOverride - Optional argument overrides
   * @yields Prompt objects from the subtask
   * @returns CommandResult from the executed task
   */
  // Overload 1: Registered task - fully typed params and result
  runWithPrompts<K extends keyof CommandTypesRegistry>(
    commandName: K,
    argsOverride?: Partial<CommandTypesRegistry[K]['params']>,
  ): AsyncGenerator<Prompt, CommandResult<CommandTypesRegistry[K]['result']>, string>

  // Overload 2: Unregistered task - loose typing
  // deno-lint-ignore no-explicit-any
  runWithPrompts<T = any>(
    commandName: string,
    argsOverride?: Record<string, unknown>,
  ): AsyncGenerator<Prompt, CommandResult<T>, string>

  // Implementation
  // deno-lint-ignore no-explicit-any
  async *runWithPrompts<T = any>(
    commandName: string,
    argsOverride?: Record<string, unknown>,
  ): AsyncGenerator<Prompt, CommandResult<T>, string> {
    // Load task class
    const TaskClass = await this.get(commandName)
    // deno-lint-ignore no-explicit-any
    const commandInstance = new (TaskClass as any)()
    const commandDescription = TaskClass.description

    // Step 1: Transform parent args using child task's description
    const baseArgsForTransform: Args = { _: [], ...this.currentArgs }

    let transformedArgs: Record<string, unknown>
    if (commandDescription?.params) {
      // Include argsOverride so required-param checks see them (see run() for details)
      // Pass compositionDepth to suppress unknown-flag warnings for nested task calls.
      const argsWithOverrides: Args = { ...baseArgsForTransform, ...argsOverride }
      transformedArgs = await transformTypedParamsArgs(commandDescription.params, argsWithOverrides, {
        compositionDepth: this.context.compositionDepth + 1,
      })
    } else {
      transformedArgs = this.currentArgs
    }

    // Step 2: Merge transformed args with overrides
    const finalArgs = { ...transformedArgs, ...argsOverride }

    // Step 3: Create child context with nested output and incremented composition depth
    const childOutput = this.context.output.child?.(commandName) ?? this.context.output
    const childContext = this.context.fork({
      output: childOutput,
      compositionDepth: this.context.compositionDepth + 1,
      parentTaskName: this.currentTaskName,
    })

    // Step 4: Create child CommandService for subtask
    // Pass commandName as currentTaskName so grandchildren know their parent
    const childService = new CommandService(childContext, finalArgs, this.rawArgs, commandName)

    // Step 5: Create CommandArgs for child task
    const commandArgs: CommandArgs = {
      args: finalArgs,
      context: childContext,
      tasks: childService,
      rawArgs: this.rawArgs,
    }

    // Step 6: Delegate to task's runWithPrompts generator
    // yield* forwards all prompts to our caller and returns the final result
    const result = yield* commandInstance.runWithPrompts(commandArgs)

    return result as CommandResult<T>
  }

  // Future methods (documented but not implemented):
  //
  // clear(): void
  //   Clear the shared task cache. Useful for testing and development.
  //   Forces tasks to be reloaded on next get().
  //
  // invalidate(commandName: string): void
  //   Remove a specific task from the cache. Useful for hot-reload
  //   during development.
  //
  // has(commandName: string): boolean
  //   Check if a task exists without loading it. Useful for validation.
  //
  // list(): string[]
  //   List all available tasks. Useful for CLI discovery and help commands.
}
