import { asSchema, type Tool } from 'ai'
import type { ResponseInputContent } from 'openai/resources/responses/responses'
import { READ_FILE_TOOL } from '#commands/lib/chat/fileTools.ts'
import { loadDocument } from '#lib/documents/loadDocument.ts'
import { type DocumentPage, documentPage, FIND_LEAD_CHARS, locateText } from '#shared/models/AI/DocumentPages/mod.ts'
import { observeTools, type ToolExecutionEvent } from '#shared/models/Chat/ChatEngine/toolExecution.ts'
import type ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import type { EffortOverride } from '#universal/ai/effort.ts'
import type { SpokenTurn } from '../chat/voiceTranscript.ts'
import type { VoiceTool, VoiceToolOutput } from './mod.ts'

export interface VoiceChatRequest {
  id: string
  after: number
  profile: string
  effort: EffortOverride
  saves: boolean
}

export interface VoiceChatAccess {
  signal?: AbortSignal
  build: (turns: readonly SpokenTurn[]) => ReturnType<ChatSession['conversationTools']>
  record: (event: ToolExecutionEvent, turns: readonly SpokenTurn[]) => void
  persist: () => Promise<void>
  close: () => Promise<void>
}

export type VoiceChatOpener = (request: VoiceChatRequest, signal: AbortSignal) => Promise<VoiceChatAccess>

type ModelOutput = Awaited<ReturnType<NonNullable<Tool['toModelOutput']>>>

/** Preserve native file/image parts; a JSON description alone does not let Sol read the document. */
export function liveToolOutput(output: ModelOutput): VoiceToolOutput {
  if (output.type === 'text' || output.type === 'error-text') return output.value
  if (output.type === 'execution-denied') return output.reason ?? 'The user declined this action.'
  if (output.type !== 'content') return JSON.stringify(output.value)
  return output.value.map((part): ResponseInputContent => {
    if (part.type === 'text') return { type: 'input_text', text: part.text }
    if (part.type === 'file') {
      const data = part.data
      if (part.mediaType.startsWith('image/')) {
        return {
          type: 'input_image',
          detail: 'auto',
          ...(data.type === 'data'
            ? { image_url: `data:${part.mediaType};base64,${data.data}` }
            : data.type === 'url'
              ? { image_url: String(data.url) }
              : data.type === 'reference' && typeof data.reference === 'string'
                ? { file_id: data.reference }
                : (() => {
                    throw new Error('This image result cannot be sent to voice.')
                  })()),
        }
      }
      if (data.type === 'data')
        return {
          type: 'input_file',
          filename: part.filename ?? 'document.pdf',
          file_data: `data:${part.mediaType};base64,${data.data}`,
        }
      if (data.type === 'url') return { type: 'input_file', file_url: String(data.url) }
      if (data.type === 'reference' && typeof data.reference === 'string')
        return { type: 'input_file', file_id: data.reference }
      if (data.type === 'text') return { type: 'input_text', text: data.text }
    }
    throw new Error(`Voice cannot read this tool result format: ${part.type}`)
  })
}

/** A voice read returns at most this much text; find opens the passage that matters. */
export const VOICE_READ_CHARS = 8000

/**
 * Slow reads that run past their delegation (see VoiceTool.background): the person keeps talking
 * while one runs, and its findings reach the conversation when it lands.
 */
const BACKGROUND_TOOLS = new Set(['ai_research'])

/** read_file's own parameters plus the two that page it in voice. */
function pagedReadParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const properties = (parameters.properties ?? {}) as Record<string, unknown>
  return {
    ...parameters,
    properties: {
      ...properties,
      find: {
        type: 'string',
        description:
          'A distinctive name, date or phrase to open the page at, ignoring case. Use it to read the passage you need instead of the whole file.',
      },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Character offset to read from, such as a previous page’s next offset. Defaults to the start.',
      },
    },
  }
}

/** Where a page sits in the text, and how to read on from it. */
function pagePosition(page: DocumentPage): string {
  if (!page.truncated) return ''
  const n = (value: number) => value.toLocaleString('en-US')
  const next =
    page.nextOffset !== undefined
      ? ` Continue with read_file offset ${page.nextOffset}, or use find, only if the answer is not here.`
      : ''
  return `Showing characters ${n(page.offset)} to ${n(page.offset + page.markdown.length)} of ${n(page.totalChars)}.${next}`
}

/**
 * One page of a text read: the file's header, where the page sits in the text, and the page itself.
 * A file that fits in one page comes back whole, find or not, since its start holds the title, who and
 * when. `fullText` is the whole document when read_file cut it to its first part: voice pages the whole.
 * PDFs and images pass through whole, as the model reads them natively.
 */
export function pageReadOutput(
  output: VoiceToolOutput,
  request: { offset?: number; find?: string },
  fullText?: string,
): VoiceToolOutput {
  if (!Array.isArray(output) || output.length !== 1 || output[0]?.type !== 'input_text') return output
  const text = output[0].text
  const split = text.indexOf('\n\n')
  if (split < 0) return output
  let header = text.slice(0, split)
  let body = text.slice(split + 2)
  if (fullText !== undefined) {
    body = fullText
    header = header.replace(
      /^Type: text, cut to the first [\d,]+ characters of ([\d,]+)$/m,
      'Type: text, $1 characters',
    )
  }
  const offset = Math.min(request.offset ?? 0, body.length)
  const reply = (lines: string[], page: string) => [
    { type: 'input_text' as const, text: `${[header, ...lines.filter(Boolean)].join('\n')}\n\n${page}` },
  ]
  if (body.length <= VOICE_READ_CHARS && offset === 0) {
    const missing = request.find !== undefined && locateText(body, request.find) === undefined
    return reply(
      [missing ? `The text "${request.find}" does not appear in this file; the whole file follows.` : ''],
      body,
    )
  }
  if (request.find) {
    const at = locateText(body, request.find, offset)
    if (at === undefined) {
      // A miss still returns the page at the offset: the wording may differ from the find term.
      const page = documentPage('', body, offset, VOICE_READ_CHARS)
      return reply(
        [
          `The text "${request.find}" was not found at or after character ${offset.toLocaleString('en-US')} of ${body.length.toLocaleString('en-US')}.`,
          pagePosition(page),
        ],
        page.markdown,
      )
    }
    // Open a little before the match, and fill the page when the match is near the end, starting on a whole
    // character so the page still reaches the end.
    let fill = body.length - VOICE_READ_CHARS
    const unit = body.charCodeAt(fill)
    if (unit >= 0xdc00 && unit <= 0xdfff) fill++
    const page = documentPage('', body, Math.max(offset, Math.min(at - FIND_LEAD_CHARS, fill)), VOICE_READ_CHARS)
    return reply([pagePosition(page)], page.markdown)
  }
  const page = documentPage('', body, offset, VOICE_READ_CHARS)
  return reply([pagePosition(page)], page.markdown)
}

/**
 * The whole text of a read that read_file cut to its first part for chat's context budget. Voice reads a
 * page at a time, so find and offset can reach the rest. The file was just read under the same grants.
 */
async function wholeText(output: unknown): Promise<string | undefined> {
  const read = output as { success?: boolean; kind?: string; totalChars?: number; path?: string } | null
  if (!read?.success || read.kind !== 'text' || read.totalChars === undefined || !read.path) return undefined
  const loaded = await loadDocument(read.path).catch(() => undefined)
  return loaded?.success && loaded.document.kind === 'text' ? loaded.document.text : undefined
}

/** Transport adapter only: the actual tools, policy, context and products belong to chat. */
export async function voiceChatTools(access: VoiceChatAccess, turns: readonly SpokenTurn[], signal: AbortSignal) {
  const built = await access.build(turns)
  if (access.signal) signal = AbortSignal.any([signal, access.signal])
  const executable = observeTools(built.tools as Record<string, Tool>, (event) => access.record(event, turns), signal)
  const tools = new Map<string, VoiceTool>()
  for (const [name, tool] of Object.entries(executable)) {
    if (!tool.execute) throw new Error(`The chat tool ${name} has no local executor.`)
    const schema = asSchema(tool.inputSchema)
    const validate = async (input: Record<string, unknown>) => {
      const result = await schema.validate?.(input)
      if (result && !result.success) throw new Error(`Invalid ${name} arguments: ${result.error.message}`)
      return result?.success ? result.value : input
    }
    const policy = built.toolApproval[name]
    // The one place voice reshapes a chat tool: a spoken turn waits on every read, so a read is a page.
    const paged = name === READ_FILE_TOOL
    const parameters = (await schema.jsonSchema) as Record<string, unknown>
    tools.set(name, {
      definition: {
        type: 'function',
        name,
        description: typeof tool.description === 'function' ? tool.description({ context: {} }) : tool.description,
        parameters: paged ? pagedReadParameters(parameters) : parameters,
        strict: false,
      },
      ...(BACKGROUND_TOOLS.has(name) ? { background: true } : {}),
      needsApproval: Boolean(policy),
      needsApprovalFor: async (input) => {
        await validate(input)
        return typeof policy === 'function' ? (await policy(input)) === 'user-approval' : Boolean(policy)
      },
      prepareApproval: async (input, callSignal) => {
        if (!built.prepareApproval) throw new Error('This chat host cannot prepare spoken approvals.')
        return built.prepareApproval(name, input, callSignal)
      },
      run: async (input, callSignal, _delegationId, callId = crypto.randomUUID()) => {
        const abortSignal = AbortSignal.any([signal, ...(callSignal ? [callSignal] : [])])
        abortSignal.throwIfAborted()
        const { find, offset, ...own } = input
        const request = {
          ...(typeof find === 'string' && find.trim() ? { find: find.trim() } : {}),
          ...(typeof offset === 'number' && Number.isFinite(offset) && offset > 0
            ? { offset: Math.trunc(offset) }
            : {}),
        }
        const valid = await validate(paged ? own : input)
        try {
          const output = await tool.execute!(valid, { toolCallId: callId, messages: [], abortSignal, context: {} })
          if (output && typeof output === 'object' && Symbol.asyncIterator in output)
            throw new Error(`The chat tool ${name} returned a streaming result that voice could not collect.`)
          const result = tool.toModelOutput
            ? liveToolOutput(await tool.toModelOutput({ toolCallId: callId, input: valid, output }))
            : JSON.stringify(output ?? null)
          if (!paged) return result
          return pageReadOutput(result, request, await wholeText(output))
        } finally {
          await access.persist()
        }
      },
    })
  }
  // A spoken session starts from these instructions, so the data a chat turn receives with its message goes here.
  return {
    tools,
    instructions: [built.systemInstructions, built.instructions, built.referenceData].filter(Boolean).join('\n\n'),
  }
}
