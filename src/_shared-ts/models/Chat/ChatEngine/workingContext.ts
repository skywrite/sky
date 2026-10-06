import { createHash } from 'node:crypto'
import type { ModelMessage } from 'ai'
import { z } from 'zod'
import type { ContextTurnLog } from '../document/ContextLog/mod.ts'
import type { ConversationMessage } from '../type.d.ts'

export const NOTEBOOK_ADDITION =
  '[Notebook documents the assistant retrieved for the message that follows — not written by the person. They join the Activity section of the instructions.]'

const schema = z.object({
  sources: z.array(
    z.object({
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      user: z.number().int().min(0),
      chars: z.number().int().positive(),
      paths: z.array(z.string()),
      compacted: z.boolean(),
    }),
  ),
  toolExcerpts: z.record(z.string(), z.string()),
  deferredAttachments: z.array(z.string()).optional(),
})
export type WorkingContextState = z.infer<typeof schema>

export function readWorkingContext(value: unknown): WorkingContextState | undefined {
  return schema.safeParse(value).data
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex')

/** Full history stays intact. This records only the smaller view sent to the model. */
export class WorkingContext {
  readonly state: WorkingContextState

  constructor(state?: WorkingContextState) {
    this.state = structuredClone(state ?? { sources: [], toolExcerpts: {} })
  }

  register(text: string, paths: string[], user: number): void {
    const digest = hash(text)
    if (!this.state.sources.some((source) => source.hash === digest && source.user === user))
      this.state.sources.push({ hash: digest, user, chars: text.length, paths: [...new Set(paths)], compacted: false })
  }

  private source(text: string, user: number) {
    if (!text.startsWith(NOTEBOOK_ADDITION)) return undefined
    return this.state.sources.find(
      (source) =>
        source.user === user && text.length >= source.chars && hash(text.slice(0, source.chars)) === source.hash,
    )
  }

  private reference(source: WorkingContextState['sources'][number]): string {
    return `[Earlier retrieved notebook text was removed from this model request to make room. The full text remains in saved history. Reread relevant sources with read_file before relying on omitted details. This is not evidence that a document is missing. Sources: ${JSON.stringify(source.paths)}]`
  }

  prepare(text: string, user: number): string {
    const source = this.source(text, user)
    return source?.compacted ? this.reference(source) + text.slice(source.chars) : text
  }

  compact(text: string, user: number): number {
    const source = this.source(text, user)
    if (!source || source.compacted) return 0
    const saved = source.chars - this.reference(source).length
    if (saved <= 0) return 0
    source.compacted = true
    return saved
  }

  get compactedSources(): number {
    return this.state.sources.filter((source) => source.compacted).length
  }

  /** A branch carries only the source references and result excerpts in its inherited history. */
  snapshot(messages: readonly ModelMessage[]): WorkingContextState {
    const sources: WorkingContextState['sources'] = []
    const toolIds = new Set<string>()
    let user = -1
    for (const message of messages) {
      if (message.role === 'user') {
        user++
        const text =
          typeof message.content === 'string'
            ? message.content
            : message.content[0]?.type === 'text'
              ? message.content[0].text
              : ''
        const source = this.source(text, user)
        if (source) sources.push(source)
      }
      if (message.role === 'tool')
        for (const part of message.content) if (part.type === 'tool-result') toolIds.add(part.toolCallId)
    }
    return structuredClone({
      sources,
      toolExcerpts: Object.fromEntries(Object.entries(this.state.toolExcerpts).filter(([id]) => toolIds.has(id))),
      ...(this.state.deferredAttachments && {
        deferredAttachments: this.state.deferredAttachments.filter((key) => {
          const userFile = /^user:(\d+):\d+$/.exec(key)
          if (userFile) return Number(userFile[1]) <= user
          const toolFile = /^tool:(.+):\d+$/.exec(key)
          return !!toolFile && toolIds.has(toolFile[1])
        }),
      }),
    })
  }

  /** Older snapshots mixed retrieval and user prose. Require both trusted log provenance and the exact user suffix. */
  adoptLegacy(
    messages: ModelMessage[],
    conversation: ConversationMessage[],
    log: ContextTurnLog[],
    resolve: (path: string) => string,
    stamp: (when: string) => string,
  ): void {
    const users = conversation.filter((message) => message.role === 'user')
    let turn = 0
    for (const message of messages) {
      if (message.role !== 'user') continue
      const user = users[turn++]
      const entry = log.find((item) => item.turn === turn)
      if (!user || !entry?.added?.length) continue
      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content[0]?.type === 'text'
            ? message.content[0].text
            : ''
      if (!content.startsWith(NOTEBOOK_ADDITION) || this.source(content, turn - 1)) continue
      const suffix = `${user.when ? `${stamp(user.when)}\n` : ''}${user.content}`
      // Native-file messages already separate the user text into the next part.
      const separate =
        Array.isArray(message.content) &&
        message.content.some((part, index) => index > 0 && part.type === 'text' && part.text === suffix)
      if (!separate && !content.endsWith(`\n\n${suffix}`)) continue
      const prefix = separate ? content : content.slice(0, -suffix.length - 2)
      this.register(
        prefix,
        entry.added.map((source) => resolve(source.path)),
        turn - 1,
      )
    }
  }
}
