export type * from '#commands/lib/commands.d.ts'
export { CommandResult, isError, isFail, isFailOrError, isSuccess } from '#commands/lib/core/CommandResult.ts'
export { Command } from '#commands/lib/core/Command.ts'
export { CommandPlatform, default as CommandContext } from '#commands/lib/core/CommandContext.ts'
export type { CommandContextOptions } from '#commands/lib/core/CommandContext.ts'
export { default as CommandService } from '#commands/lib/core/CommandService.ts'

// Param builders for typed task arguments
export { Arg, ArgOrFlag, Flag } from '#commands/lib/params.ts'
export type { InferParams, InferParamsInput, ParamDef, ParamOptions, ParamsRecord } from '#commands/lib/params.ts'

// Standard params for common patterns
export {
  category,
  categoryCommitment,
  categoryComplete,
  categoryTodo,
  dayArg,
  dayFlag,
  dayNoFutureArg,
  dayNoFutureFlag,
  dayYesterdayArg,
  dryRun,
  when,
  whenNBTime,
} from '#commands/lib/standardParams.ts'

// AI Chat tool decorator
export { AIChatTool } from '#commands/lib/AIChatTool.ts'
export type { AIChatToolOptions } from '#commands/lib/AIChatTool.ts'

// Task types registry for typed composition
export type {
  CommandParams,
  CommandResultType,
  CommandTypesRegistry,
  IsRegisteredCommand,
} from '#commands/lib/core/CommandTypesRegistry.ts'
