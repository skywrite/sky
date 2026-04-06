import type { Args, CommandDescription } from '#commands/lib/commands.d.ts'

export type CommandDescriptionCliPostProcessFunction = (
  result: Record<string, any>,
  rawArgs: Args,
  commandDesc: CommandDescription,
) => string | undefined

/**
 * Validates that a specific arg or flag exists in the transformed args.
 */
export function validateArgOrFlagExists(argOrFlagName: string): CommandDescriptionCliPostProcessFunction {
  return (transformedArgs) => {
    return transformedArgs[argOrFlagName] ? undefined : `${argOrFlagName} is required.`
  }
}

/**
 * Validates that at least one of the specified args/flags exists.
 */
export function validateAnyArgFlagExists(...argOrFlagNames: string[]): CommandDescriptionCliPostProcessFunction {
  return (transformedArgs) => {
    return argOrFlagNames.filter((argOrFlag) => transformedArgs[argOrFlag]).length > 0
      ? undefined
      : `One of these flags/args ${argOrFlagNames.join(',')} is required.`
  }
}
