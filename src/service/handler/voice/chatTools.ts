import { asSchema, type Tool } from 'ai'
import type { ResponseInputContent } from 'openai/resources/responses/responses'
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
  contextTokens: number
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
    tools.set(name, {
      definition: {
        type: 'function',
        name,
        description: typeof tool.description === 'function' ? tool.description({ context: {} }) : tool.description,
        parameters: await schema.jsonSchema,
        strict: false,
      },
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
        const valid = await validate(input)
        try {
          const output = await tool.execute!(valid, { toolCallId: callId, messages: [], abortSignal, context: {} })
          if (output && typeof output === 'object' && Symbol.asyncIterator in output)
            throw new Error(`The chat tool ${name} returned a streaming result that voice could not collect.`)
          return tool.toModelOutput
            ? liveToolOutput(await tool.toModelOutput({ toolCallId: callId, input: valid, output }))
            : JSON.stringify(output ?? null)
        } finally {
          await access.persist()
        }
      },
    })
  }
  return { tools, instructions: [built.systemInstructions, built.instructions].filter(Boolean).join('\n\n') }
}
