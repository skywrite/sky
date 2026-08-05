/**
 * Auto-discover @AIChatTool decorated tasks and generate Vercel AI SDK tools.
 *
 * Reads the on-disk command manifest (built by the command-runner) which already
 * enumerates every command across `commands/all` + `commands.dirs` and stores an
 * `aiChatTool` flag set via runtime `isAIChatTool()` during manifest build. Schemas
 * are derived from task params via the shared jsonSchema module — zero duplication.
 */

import { jsonSchema, tool } from 'ai'
import colors from 'picocolors'
import { getManifest } from '#commands/all/cli/_commandsManifest.ts'
import { getAIChatToolOptions, isAIChatTool } from '#commands/lib/AIChatTool.ts'
import type { ApprovalSessionKeyFn, FormatApprovalFn } from '#commands/lib/AIChatTool.ts'
import { commandDescriptionToSchema, commandNameToToolName } from '#commands/lib/jsonSchema.ts'
import { Command, CommandService } from '#commands/mod.ts'
import { logAIError } from '#shared/ai/errorLog.ts'

// -----------------------------------------------------------------------------
// Discovery
// -----------------------------------------------------------------------------

async function findAIChatToolFiles(): Promise<string[]> {
  const manifest = await getManifest()
  return [...manifest.commands.core, ...manifest.commands.local, ...manifest.commands.global]
    .filter((c) => c.aiChatTool)
    .map((c) => c.file)
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
 * Files already reported as unimportable. ai:chat rebuilds its tools every
 * turn, so without this the same failure would warn on every turn and append
 * a line to the error log each time.
 */
const reportedImportFailures = new Set<string>()

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
    } catch (err) {
      // The manifest said aiChatTool:true, but the file no longer imports —
      // typically an external group whose `node_modules` went missing, so
      // `@skywrite/*` can't resolve. Swallowing this dropped the tool with no
      // trace at scan time (the manifest was built while it still worked) or
      // at chat time, leaving a session that silently cannot act.
      const message = (err as Error).message
      if (!reportedImportFailures.has(file)) {
        reportedImportFailures.add(file)
        console.warn(colors.yellow(`⚠ [sky] ai:chat tool unavailable: failed to import ${file} — ${message}`))
        await logAIError({
          source: 'ai:chat',
          stage: 'tools:discover',
          message: `Failed to import AI chat tool ${file}: ${message}`,
        })
      }
    }
  }

  return results
}

/**
 * Discover @AIChatTool decorated tasks and create Vercel AI SDK tools.
 *
 * Filters the on-disk command manifest by `aiChatTool`, then imports each
 * matching file to read its CommandDescription params and decorator options.
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
 * Generation-time approval policy for the discovered tools. AI SDK 7 moved
 * approval off the tool definition (tool-level needsApproval is deprecated)
 * onto the streamText/generateText call; the decorator's needsApproval flag
 * remains the source of truth and is translated here. Call after
 * createNotebookTools(), which populates the registry.
 */
export function createToolApprovalConfig(): Record<string, 'user-approval'> {
  const config: Record<string, 'user-approval'> = {}
  for (const entry of discoveredTools) {
    if (entry.needsApproval) config[entry.toolName] = 'user-approval'
  }
  return config
}

/**
 * Get the formatApproval function for a tool, if the task class defines one.
 */
export function getApprovalFormatter(toolName: string): FormatApprovalFn | undefined {
  const found = discoveredTools.find((t) => t.toolName === toolName)
  if (!found) return undefined
  return found.commandClass.formatApproval as FormatApprovalFn | undefined
}

/**
 * Get the approvalSessionKey function for a tool, if the task class defines
 * one — the hook behind "don't ask again for this one this session".
 */
export function getApprovalSessionKey(toolName: string): ApprovalSessionKeyFn | undefined {
  const found = discoveredTools.find((t) => t.toolName === toolName)
  if (!found) return undefined
  return found.commandClass.approvalSessionKey as ApprovalSessionKeyFn | undefined
}
