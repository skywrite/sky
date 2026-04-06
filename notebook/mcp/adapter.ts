/**
 * Adapter to convert between notebook CommandDescription and MCP tool schemas.
 *
 * Schema generation and name conversion are delegated to the shared
 * commands/lib/jsonSchema.ts module. This file re-exports them under the
 * original MCP-prefixed names for backwards compatibility, and adds
 * MCP-specific argument conversion.
 */

import type { CommandDescription } from '#commands/lib/commands.d.ts'
import type { ParamsRecord } from '#commands/lib/params.ts'
import {
  commandDescriptionToSchema,
  commandNameToToolName,
  type InputSchema,
  toolNameToCommandName,
} from '#commands/lib/jsonSchema.ts'

// Re-export under original names for existing MCP consumers
export type MCPInputSchema = InputSchema

export function commandDescriptionToMCPSchema(commandDesc: CommandDescription): MCPInputSchema {
  return commandDescriptionToSchema(commandDesc)
}

export function commandNameToMCPToolName(commandName: string): string {
  return commandNameToToolName(commandName)
}

export function mcpToolNameToCommandName(toolName: string): string {
  return toolNameToCommandName(toolName)
}

/**
 * Convert MCP tool arguments to CommandArgs format
 */
export async function mcpArgsToCommandArgs(
  mcpArgs: Record<string, unknown>,
  commandDesc: CommandDescription,
): Promise<Record<string, unknown>> {
  if (commandDesc.params) {
    return await mcpArgsToParams(mcpArgs, commandDesc.params)
  }

  // No params defined - return args as-is
  return mcpArgs
}

/**
 * Convert MCP args using params definitions
 */
async function mcpArgsToParams(
  mcpArgs: Record<string, unknown>,
  params: ParamsRecord,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {}

  for (const [name, param] of Object.entries(params)) {
    if (mcpArgs[name] !== undefined) {
      // Apply parse function if available
      if (param.parse) {
        result[name] = await param.parse(mcpArgs[name] as string)
      } else if (param.schema) {
        // Validate and coerce with Zod schema
        const parseResult = param.schema.safeParse(mcpArgs[name])
        if (parseResult.success) {
          result[name] = parseResult.data
        } else {
          result[name] = mcpArgs[name]
        }
      } else {
        result[name] = mcpArgs[name]
      }
    } else if (param.default !== undefined) {
      // Apply default (value or function)
      result[name] = typeof param.default === 'function' ? await param.default() : param.default
    }
  }

  return result
}
