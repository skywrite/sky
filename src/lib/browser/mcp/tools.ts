import { rename, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { jsonSchema, type Tool, tool } from 'ai'
import type { CallOptions, McpContent, McpImageContent, McpToolDefinition, McpToolResult } from './client.ts'

// The browser server's tools, as the model sees them. Each becomes an AI
// SDK tool whose result carries the page as text and any screenshot as a
// real image part — a filename or a base64 string in prose is not an image
// to a model.

/** What toModelOutput returns — the SDK exports the hook's type but not its result's. */
type ToolResultOutput = Awaited<ReturnType<NonNullable<Tool['toModelOutput']>>>

/** The part of a client a tool needs — a stub satisfies it in tests. */
export interface ToolCaller {
  callTool(name: string, args: Record<string, unknown>, options?: CallOptions): Promise<McpToolResult>
}

/**
 * The tools a task may use. The server offers more — arbitrary code in the
 * page or the server process, request bodies with their headers, closing
 * the browser, switching tabs. Those are host controls or leaks, not moves
 * in a task, so they never reach the model; another task may be working in
 * the next tab.
 */
export const BROWSER_TOOL_NAMES: readonly string[] = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_find',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_press_key',
  'browser_hover',
  'browser_select_option',
  'browser_drag',
  'browser_wait_for',
  'browser_handle_dialog',
  'browser_take_screenshot',
  'browser_file_upload',
  'browser_mouse_click_xy',
  'browser_mouse_move_xy',
  'browser_mouse_drag_xy',
  'browser_mouse_wheel',
]

export interface BrowserToolOutput {
  ok: boolean
  text: string
  /** Images the result carried — the model receives them; the log only counts them */
  images: number
}

export interface BrowserToolsOptions {
  allow?: readonly string[]
  timeoutMs?: number
  /** A task's own folder for downloads, when the driver puts them somewhere shared */
  downloads?: DownloadClaim
}

export interface DownloadClaim {
  /** Where the driver saves downloads */
  from: string
  /** Where this task keeps its own */
  to: string
}

const DOWNLOADED = /Downloaded file (.+?) to "(.+?)"/g

/** A free name beside the wanted one. */
async function freeName(wanted: string): Promise<string> {
  const ext = path.extname(wanted)
  const stem = wanted.slice(0, wanted.length - ext.length)
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? wanted : `${stem} (${n})${ext}`
    try {
      await stat(candidate)
    } catch {
      return candidate
    }
  }
}

/**
 * A driver shared between tasks saves every download in one folder. The
 * task whose move produced a download moves it into its own folder at once,
 * and the result names the new place, so nothing is attributed to a later
 * task or left behind.
 */
export async function claimDownloads(text: string, claim: DownloadClaim): Promise<{ text: string; moved: string[] }> {
  const moved: string[] = []
  let out = text
  for (const match of text.matchAll(DOWNLOADED)) {
    const [line, name, where] = match
    const source = path.isAbsolute(where) ? where : path.resolve(claim.from, where)
    const destination = await freeName(path.join(claim.to, path.basename(name)))
    try {
      await rename(source, destination)
    } catch {
      continue // already moved, or not there yet
    }
    moved.push(destination)
    out = out.replace(line, `Downloaded file ${path.basename(destination)} to "${destination}"`)
  }
  return { text: out, moved }
}

/**
 * Images by tool call id, for toModelOutput. The raw output stays small
 * JSON (it is logged as such) while the picture rides the model-facing
 * result. Bounded: a call's image is read once, right after it ran.
 */
const images = new Map<string, McpImageContent[]>()
const MAX_REMEMBERED = 8

function remember(toolCallId: string, found: McpImageContent[]): void {
  if (found.length === 0) return
  images.set(toolCallId, found)
  while (images.size > MAX_REMEMBERED) {
    const oldest = images.keys().next().value
    if (oldest === undefined) break
    images.delete(oldest)
  }
}

const isText = (part: McpContent): part is { type: 'text'; text: string } =>
  part.type === 'text' && typeof (part as { text?: unknown }).text === 'string'

const isImage = (part: McpContent): part is McpImageContent =>
  part.type === 'image' && typeof (part as { data?: unknown }).data === 'string'

/** Split a server result into its text and its images. */
export function splitResult(result: McpToolResult): { output: BrowserToolOutput; images: McpImageContent[] } {
  const text = result.content
    .filter(isText)
    .map((part) => part.text)
    .join('\n')
  const found = result.content.filter(isImage)
  return {
    output: { ok: !result.isError, text: text || (found.length > 0 ? '' : '(no result)'), images: found.length },
    images: found,
  }
}

/** Whether execute produced this, rather than the engine standing in for it (a refused repeat, a stop). */
export const isBrowserToolOutput = (output: unknown): output is BrowserToolOutput =>
  typeof output === 'object' && output !== null && typeof (output as BrowserToolOutput).text === 'string'

/** The result as the model receives it: text, an error, or text with the images attached. */
export function toModelContent(output: BrowserToolOutput, found: McpImageContent[]): ToolResultOutput {
  if (found.length === 0)
    return output.ok ? { type: 'text', value: output.text } : { type: 'error-text', value: output.text }
  return {
    type: 'content',
    value: [
      { type: 'text', text: output.text },
      ...found.map((image, index) => ({
        type: 'file' as const,
        mediaType: image.mimeType,
        filename: `image-${index + 1}.${image.mimeType.split('/')[1] ?? 'png'}`,
        data: { type: 'data' as const, data: image.data },
      })),
    ],
  }
}

/**
 * The allowed server tools as AI SDK tools, keyed by their server names.
 * Typed as the engine takes them: a record of tools, each its own shape.
 */
export function browserToolsFrom(
  client: ToolCaller,
  definitions: McpToolDefinition[],
  options: BrowserToolsOptions = {},
): Record<string, unknown> {
  const allow = new Set(options.allow ?? BROWSER_TOOL_NAMES)
  const tools: Record<string, unknown> = {}
  for (const definition of definitions) {
    if (!allow.has(definition.name)) continue
    tools[definition.name] = tool<Record<string, unknown>, BrowserToolOutput, Record<string, unknown>>({
      description: definition.description ?? definition.name,
      inputSchema: jsonSchema<Record<string, unknown>>(definition.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (input: Record<string, unknown>, { toolCallId, abortSignal }): Promise<BrowserToolOutput> => {
        try {
          const result = await client.callTool(definition.name, input, {
            timeoutMs: options.timeoutMs,
            signal: abortSignal,
          })
          const split = splitResult(result)
          remember(toolCallId, split.images)
          if (options.downloads) split.output.text = (await claimDownloads(split.output.text, options.downloads)).text
          return split.output
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error), images: 0 }
        }
      },
      toModelOutput: ({ toolCallId, output }) => {
        const found = images.get(toolCallId) ?? []
        images.delete(toolCallId)
        // The engine answers some calls itself — a refused repeat is a
        // plain string — and that passes through as it is.
        if (typeof output === 'string') return { type: 'text', value: output }
        if (!isBrowserToolOutput(output)) return { type: 'json', value: output as never }
        return toModelContent(output, found)
      },
    })
  }
  return tools
}
