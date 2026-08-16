/**
 * Convert task param definitions to JSON Schema.
 *
 * This is the shared schema layer used by the AI Chat tool generator -
 * anything that needs to expose task params as a JSON Schema object.
 */

import { z } from 'zod'
import type { CommandDescription } from '#commands/lib/commands.d.ts'
import type { ParamDef, ParamsRecord } from '#commands/lib/params.ts'

/** JSON Schema for a tool's input */
export type InputSchema = {
  type: 'object'
  properties: Record<string, Record<string, unknown>>
  required?: string[]
}

/**
 * Convert CommandDescription params to JSON Schema.
 * Skips hidden params. Marks non-optional params without defaults as required.
 */
export function commandDescriptionToSchema(commandDesc: CommandDescription): InputSchema {
  if (commandDesc.params) {
    return paramsToSchema(commandDesc.params)
  }
  return { type: 'object', properties: {} }
}

function paramsToSchema(params: ParamsRecord): InputSchema {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const [name, param] of Object.entries(params)) {
    if (param.hidden) continue

    properties[name] = paramToJSONSchema(param)

    if (!param.optional && param.default === undefined) {
      required.push(name)
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  }
}

/**
 * Convert a single param definition to a JSON Schema property.
 *
 * - Date types get hand-crafted schemas (Zod's preprocess+instanceof produces unusable JSON Schema)
 * - Primitives use z.toJSONSchema() to capture constraints (enums, min/max, etc.)
 * - Falls back to { type: param.jsonType } if z.toJSONSchema() fails
 */
function paramToJSONSchema(param: ParamDef): Record<string, unknown> {
  const { type, description } = param

  if (type === 'plainDate') {
    return { type: 'string', description, format: 'date', examples: ['2026-02-12'] }
  }
  if (type === 'plainDateTime') {
    return { type: 'string', description, examples: ['2026-02-12 14:30'] }
  }
  if (type === 'zonedDateTime') {
    return { type: 'string', description, examples: ['2026-02-12 14:30,America/New_York'] }
  }

  if (param.schema) {
    try {
      const jsonSchema = z.toJSONSchema(param.schema)
      const { $schema: _, ...rest } = jsonSchema as Record<string, unknown>
      if (rest.type) {
        return { ...rest, description }
      }
    } catch {
      // Fall through to fallback
    }
  }

  return { type: param.jsonType, description }
}

/**
 * Convert task name to tool name (colons to underscores).
 * e.g., "meeting:new" -> "meeting_new"
 */
export function commandNameToToolName(commandName: string): string {
  return commandName.replace(/:/g, '_')
}

/**
 * Convert tool name back to task name (first underscore to colon).
 * e.g., "meeting_new" -> "meeting:new"
 */
export function toolNameToCommandName(toolName: string): string {
  const parts = toolName.split('_')
  if (parts.length >= 2) {
    return `${parts[0]}:${parts.slice(1).join('_')}`
  }
  return toolName
}
