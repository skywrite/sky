/**
 * Minimal decorator to mark tasks as MCP-exposed tools.
 * The decorator itself just adds metadata - all the heavy lifting
 * is done by extracting info from the existing CommandDescription.
 */

import 'reflect-metadata'

const MCP_METADATA_KEY = Symbol('mcp-tool')

export interface MCPToolOptions {
  // Optional overrides, but we'll mostly use CommandDescription
  name?: string // If not provided, derived from task name
  description?: string // If not provided, use task description
  // We can add more options later if needed
}

/**
 * Decorator to mark a task class as exposed via MCP.
 * Usage:
 * @MCPTool()
 * export default class MeetingNewTask extends Command { ... }
 */
export function MCPTool(options: MCPToolOptions = {}) {
  return function (target: any) {
    // Store the options on the class metadata
    Reflect.defineMetadata(MCP_METADATA_KEY, options, target)
    return target
  }
}

/**
 * Check if a class is decorated with @MCPTool
 */
export function isMCPTool(target: any): boolean {
  return Reflect.hasMetadata(MCP_METADATA_KEY, target)
}

/**
 * Get MCP tool options from a decorated class
 */
export function getMCPToolOptions(target: any): MCPToolOptions | undefined {
  return Reflect.getMetadata(MCP_METADATA_KEY, target)
}
