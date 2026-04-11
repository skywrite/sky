/**
 * Core task system types and abstractions
 */

export { Command } from './Command.ts'
export { CommandResult, isError, isFail, isFailOrError, isSuccess } from './CommandResult.ts'
export type { CommandResult as CommandResultType } from './CommandResult.ts'
export { CommandPlatform, default as CommandContext } from './CommandContext.ts'
export type { CommandContextOptions } from './CommandContext.ts'
export { default as CommandService } from './CommandService.ts'
