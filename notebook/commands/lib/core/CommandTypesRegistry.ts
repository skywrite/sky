/**
 * CommandTypesRegistry - Type registry for typed task composition.
 *
 * This interface is augmented by individual task files via TypeScript's
 * declaration merging. Each task that wants typed `tasks.run()` support
 * adds its entry to this interface.
 *
 * ## How It Works
 *
 * 1. Task file declares its params and result types
 * 2. Task file augments CommandTypesRegistry via declaration merging
 * 3. CommandService.run() uses the registry for type inference
 * 4. Callers get autocomplete and type checking
 *
 * ## Example: Registering a Task
 *
 * ```typescript
 * // commands/all/slack/new.ts
 * import { Flag, Command, CommandResult } from '#commands/mod.ts'
 *
 * const params = {
 *   to: Flag.string('Channel or person'),
 *   summary: Flag.string('Summary', { optional: true }),
 * }
 *
 * type Result = { filePath: string }
 *
 * // Register types via declaration merging
 * declare module '#commands/lib/core/CommandTypesRegistry.ts' {
 *   interface CommandTypesRegistry {
 *     'slack:new': {
 *       params: InferParams<typeof params>
 *       result: Result
 *     }
 *   }
 * }
 *
 * export default class SlackNewTask extends Command {
 *   // ... implementation
 * }
 * ```
 *
 * ## Example: Using Typed tasks.run()
 *
 * ```typescript
 * // Registered task - full type safety
 * const result = await tasks.run('slack:new', { to: 'alice' })
 * //                              ↑ autocomplete    ↑ type-checked
 *
 * if (result.ok) {
 *   result.data.filePath  // ← TypeScript knows this is string
 * }
 *
 * // Unregistered task - still works, loose typing
 * const result = await tasks.run('old:task', { foo: 'bar' })
 * // result.data is unknown
 * ```
 *
 * ## Benefits
 *
 * - **Types live with the task** - No separate registry file to maintain
 * - **Autocomplete for task names** - TypeScript knows all registered tasks
 * - **Type-checked args** - Can't pass wrong args to subtasks
 * - **Typed results** - No more guessing what `result.data` contains
 * - **Gradual adoption** - Unregistered tasks keep working
 * - **Zero runtime cost** - Declaration merging is compile-time only
 */

/**
 * Registry of task types for typed composition.
 *
 * Tasks augment this interface via declaration merging to enable
 * typed `tasks.run()` calls.
 *
 * @example
 * ```typescript
 * declare module '#commands/lib/core/CommandTypesRegistry.ts' {
 *   interface CommandTypesRegistry {
 *     'my:task': {
 *       params: { name: string; count?: number }
 *       result: { success: boolean }
 *     }
 *   }
 * }
 * ```
 */
// deno-lint-ignore no-empty-interface
export interface CommandTypesRegistry {
  // Empty base - each task augments this via declaration merging
}

/**
 * Helper type to check if a task name is registered.
 */
export type IsRegisteredCommand<T extends string> = T extends keyof CommandTypesRegistry ? true : false

/**
 * Get the params type for a registered task.
 */
export type CommandParams<T extends keyof CommandTypesRegistry> = CommandTypesRegistry[T]['params']

/**
 * Get the result type for a registered task.
 */
export type CommandResultType<T extends keyof CommandTypesRegistry> = CommandTypesRegistry[T]['result']
