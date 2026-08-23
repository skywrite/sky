/**
 * @skywrite/commands — Command framework for writing Sky CLI commands.
 *
 * This package provides the base classes, param builders, and types
 * needed to write commands that run in the Sky CLI.
 *
 * @example
 * ```ts
 * import { Command, CommandResult, Flag } from '@skywrite/commands'
 * import type { CommandArgs, CommandDescription, InferParams } from '@skywrite/commands'
 *
 * const params = {
 *   name: Flag.string('Your name'),
 * }
 * type Params = InferParams<typeof params>
 *
 * export default class HelloCommand extends Command {
 *   static override description: CommandDescription = {
 *     name: 'hello',
 *     description: 'Say hello',
 *     params,
 *   }
 *
 *   async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
 *     context.output.log(`Hello, ${args.name}!`)
 *     return CommandResult.success()
 *   }
 * }
 * ```
 */

// ── Core classes ──────────────────────────────────────────────────
export { Command } from '../../../src/commands/lib/core/Command.ts'
export {
  CommandResult,
  isError,
  isFail,
  isFailOrError,
  isSuccess,
} from '../../../src/commands/lib/core/CommandResult.ts'

// ── Param builders ────────────────────────────────────────────────
export { Arg, ArgOrFlag, Flag } from '../../../src/commands/lib/params.ts'
export type { InferParams, ParamDef, ParamOptions, ParamsRecord } from '../../../src/commands/lib/params.ts'

// ── Arg parsing helpers ───────────────────────────────────────────
export { parsePartialDate } from '../../../src/commands/lib/args/parsePartialDate.ts'
export type { ParsePartialDateOptions } from '../../../src/commands/lib/args/parsePartialDate.ts'

// ── AI Chat tool decorator ────────────────────────────────────────
export { AIChatTool } from '../../../src/commands/lib/AIChatTool.ts'
export type { AIChatToolOptions } from '../../../src/commands/lib/AIChatTool.ts'

// ── Types (no runtime deps) ──────────────────────────────────────
export type {
  Args,
  CommandArgs,
  CommandDescription,
  CommandDescriptionCliPostProcessFunction,
  CommandFunction,
} from '../../../src/commands/lib/commands.d.ts'

export type {
  CommandParams,
  CommandResultType,
  CommandTypesRegistry,
  IsRegisteredCommand,
} from '../../../src/commands/lib/core/CommandTypesRegistry.ts'

// CommandContext and CommandService are provided by the Sky runtime.
// External commands receive them via CommandArgs — they don't construct them.
export type { default as CommandContext, CommandContextOptions } from '../../../src/commands/lib/core/CommandContext.ts'
export { CommandPlatform } from '../../../src/commands/lib/core/CommandContext.ts'
export type { default as CommandService } from '../../../src/commands/lib/core/CommandService.ts'
