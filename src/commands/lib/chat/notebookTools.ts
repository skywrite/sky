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
import truncate from '#shared/strings/truncate.ts'

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

/** A question a tool wants the user to settle, with the default it proposes. */
export interface ToolOpenQuestion {
  question: string
  why?: string
  proposed: string
}

/** The user's settled answer to one ToolOpenQuestion. */
export interface ToolQuestionAnswer {
  question: string
  answer: string
}

/**
 * Native question breakout: invoked between a tool's execution and its result
 * reaching the model, so the user answers in-terminal — Enter per question,
 * no chat turns, no context pipeline. Returning undefined leaves the result
 * untouched (the model narrates the questions instead).
 */
export type OnOpenQuestions = (
  toolName: string,
  questions: ToolOpenQuestion[],
) => Promise<ToolQuestionAnswer[] | undefined>

/** An external file a tool touched, named by title and web URL. */
export interface ExternalFileRef {
  title: string
  url: string
}

export interface CreateNotebookToolsOptions {
  onOpenQuestions?: OnOpenQuestions
  /**
   * Fires after a tool succeeds with a `files` array naming external
   * artifacts (Google Docs/Sheets/Slides today). The host records them —
   * ai:chat cross-references them in the saved transcript's rel.
   */
  onExternalFiles?: (toolName: string, files: ExternalFileRef[]) => void
}

/**
 * Extract a well-formed openQuestions array from a tool result payload.
 * Convention: any AI chat tool may return `openQuestions` in this shape to
 * request the native breakout; malformed shapes are ignored.
 */
function extractOpenQuestions(payload: Record<string, unknown>): ToolOpenQuestion[] | undefined {
  const raw = payload.openQuestions
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const questions: ToolOpenQuestion[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return undefined
    const q = item as Record<string, unknown>
    if (typeof q.question !== 'string' || !q.question.trim()) return undefined
    if (typeof q.proposed !== 'string' || !q.proposed.trim()) return undefined
    questions.push({
      question: q.question,
      why: typeof q.why === 'string' ? q.why : undefined,
      proposed: q.proposed,
    })
  }
  return questions
}

/**
 * Extract well-formed external-file references from a tool result payload.
 * Convention: a tool may return `files` entries with a string `title` and
 * `url` to report the external artifacts it touched; entries without a URL
 * (or a malformed array) are skipped rather than failing the call.
 */
export function extractExternalFiles(payload: Record<string, unknown>): ExternalFileRef[] {
  const raw = payload.files
  if (!Array.isArray(raw)) return []
  const files: ExternalFileRef[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const f = item as Record<string, unknown>
    if (typeof f.title !== 'string' || !f.title.trim()) continue
    if (typeof f.url !== 'string' || !f.url.trim()) continue
    files.push({ title: f.title, url: f.url })
  }
  return files
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
 * Error strings crossing the tool boundary are clamped: the failure class
 * guarded against below is precisely "an error carrying megabytes".
 */
const MAX_TOOL_ERROR_CHARS = 2000

/**
 * Run one tool call: execute the command and shape its CommandResult into
 * the model-facing tool output. The output is embedded raw into the next
 * SDK step's message array and zod-validated as JSON there, so everything
 * returned here must be plain JSON — see the boundary comments inside.
 * Exported as the unit under test; createNotebookTools wires it per tool.
 */
export async function runToolCommand(
  tasks: CommandService,
  entry: Pick<DiscoveredTool, 'toolName' | 'commandName'>,
  input: Record<string, unknown>,
  options: CreateNotebookToolsOptions = {},
): Promise<Record<string, unknown>> {
  const result = await tasks.run(entry.commandName, input)
  if (result.status !== 'success') {
    // Failures cross this boundary as message strings only — never the
    // Error instance. A class instance fails the next step's validation
    // and kills the whole turn (an APICallError even drags the full
    // rejected request body along in requestBodyValues). The command's own
    // message can be a generic label, so the cause's message rides with it.
    const detail = [result.message, result.error?.message]
      .filter((m): m is string => Boolean(m))
      .filter((m, i, all) => all.indexOf(m) === i)
      .join(': ')
    return {
      success: false,
      // Business-rule 'fail' vs unexpected 'error' — the model reads this.
      status: result.status,
      error: truncate(detail || `Failed: ${entry.commandName}`, MAX_TOOL_ERROR_CHARS),
    }
  }

  const payload: Record<string, unknown> = { success: true, ...(result.data as Record<string, unknown>) }

  if (options.onExternalFiles) {
    const files = extractExternalFiles(payload)
    if (files.length > 0) options.onExternalFiles(entry.toolName, files)
  }

  // Tools returning openQuestions get the native breakout: the user
  // settles them here, between execution and the model seeing the
  // result — no chat turns spent on Q&A
  const questions = extractOpenQuestions(payload)
  if (questions && options.onOpenQuestions) {
    const answers = await options.onOpenQuestions(entry.toolName, questions)
    if (answers) {
      payload.answers = answers
      payload.openQuestions = []
    }
  }

  // The success payload crosses the same boundary: anything that is not
  // plain JSON (a class instance, a Date, an undefined array element)
  // fails the SDK's next-step validation just like the Error above. The
  // roundtrip flattens it to plain JSON and drops undefined-valued keys
  // instead of shipping them.
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>
}

/**
 * Discover @AIChatTool decorated tasks and create Vercel AI SDK tools.
 *
 * Filters the on-disk command manifest by `aiChatTool`, then imports each
 * matching file to read its CommandDescription params and decorator options.
 */
export async function createNotebookTools(
  tasks: CommandService,
  options: CreateNotebookToolsOptions = {},
): Promise<Record<string, unknown>> {
  const discovered = await discoverAIChatTools()
  const tools: Record<string, unknown> = {}

  discoveredTools.length = 0

  for (const entry of discovered) {
    const schema = commandDescriptionToSchema(entry.commandClass.description)

    discoveredTools.push(entry)

    tools[entry.toolName] = tool({
      description: entry.description,
      inputSchema: jsonSchema<Record<string, unknown>>(schema),
      execute: (input: Record<string, unknown>) => runToolCommand(tasks, entry, input, options),
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
