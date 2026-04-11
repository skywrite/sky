/**
 * Auto-discover @AIChatTool decorated tasks and generate Vercel AI SDK tools.
 *
 * Uses the same regex-scan discovery pattern as MCP (mcp/discovery.ts) to find
 * decorated tasks without importing every file. Schemas are derived from task
 * params via the MCP adapter - zero duplication.
 */

import process from 'node:process'
import { join } from 'node:path'
import { jsonSchema, tool } from 'ai'
import readTextFile from '#shared/fs/readTextFile.ts'
import { walk } from '#shared/fs/mod.ts'
import { getAIChatToolOptions, isAIChatTool } from '#commands/lib/AIChatTool.ts'
import type { FormatApprovalFn } from '#commands/lib/AIChatTool.ts'
import { commandDescriptionToSchema, commandNameToToolName } from '#commands/lib/jsonSchema.ts'
import { Command, CommandService } from '#commands/mod.ts'

// -----------------------------------------------------------------------------
// Discovery
// -----------------------------------------------------------------------------

const DECORATOR_PATTERN = /@AIChatTool\s*(?:\([^)]*\))?\s*(?:export\s+)?(?:default\s+)?class/

async function hasAIChatToolDecorator(filePath: string): Promise<boolean> {
  try {
    const content = await readTextFile(filePath)
    return DECORATOR_PATTERN.test(content)
  } catch {
    return false
  }
}

async function findAIChatToolFiles(): Promise<string[]> {
  const tasksDir = join(process.cwd(), 'commands', 'all')
  const files: string[] = []

  for await (const entry of walk(tasksDir, { exts: ['.ts'], includeDirs: false })) {
    if (entry.path.includes('_test.ts')) continue
    if (await hasAIChatToolDecorator(entry.path)) {
      files.push(entry.path)
    }
  }

  return files
}

// -----------------------------------------------------------------------------
// Tool generation
// -----------------------------------------------------------------------------

export interface DiscoveredTool {
  toolName: string
  commandName: string
  description: string
  needsApproval: boolean
  // deno-lint-ignore no-explicit-any
  commandClass: any
}

const discoveredTools: DiscoveredTool[] = []

/**
 * Discover @AIChatTool decorated tasks. Returns metadata for each tool
 * without generating AI SDK tool objects.
 */
export async function discoverAIChatTools(): Promise<DiscoveredTool[]> {
  const files = await findAIChatToolFiles()
  const results: DiscoveredTool[] = []

  for (const file of files) {
    try {
      // deno-lint-ignore no-explicit-any
      const mod = (await import(file)) as any
      const TaskClass = mod.default

      if (!TaskClass || !(TaskClass.prototype instanceof Command)) continue
      if (!isAIChatTool(TaskClass)) continue

      const options = getAIChatToolOptions(TaskClass)!
      const desc = TaskClass.description
      if (!desc?.name) continue

      results.push({
        toolName: commandNameToToolName(desc.name),
        commandName: desc.name,
        description: desc.description,
        needsApproval: options.needsApproval ?? true,
        commandClass: TaskClass,
      })
    } catch {
      // Skip files that fail to import
    }
  }

  return results
}

/**
 * Discover @AIChatTool decorated tasks and create Vercel AI SDK tools.
 *
 * Scans task files with a regex (no import), then imports only matching files
 * to read their CommandDescription params and decorator options.
 */
export async function createNotebookTools(tasks: CommandService): Promise<Record<string, unknown>> {
  const discovered = await discoverAIChatTools()
  const tools: Record<string, unknown> = {}

  discoveredTools.length = 0

  for (const entry of discovered) {
    const schema = commandDescriptionToSchema(entry.commandClass.description)

    discoveredTools.push(entry)

    tools[entry.toolName] = tool({
      description: entry.description,
      inputSchema: jsonSchema<Record<string, unknown>>(schema),
      needsApproval: entry.needsApproval,
      execute: async (input: Record<string, unknown>) => {
        const result = await tasks.run(entry.commandName, input)
        if (result.status === 'success') {
          return { success: true, ...(result.data as Record<string, unknown>) }
        }
        return { success: false, error: result.error ?? result.message ?? `Failed: ${entry.commandName}` }
      },
    })
  }

  return tools
}

/**
 * Get the formatApproval function for a tool, if the task class defines one.
 */
export function getApprovalFormatter(toolName: string): FormatApprovalFn | undefined {
  const found = discoveredTools.find((t) => t.toolName === toolName)
  if (!found) return undefined
  return found.commandClass.formatApproval as FormatApprovalFn | undefined
}
