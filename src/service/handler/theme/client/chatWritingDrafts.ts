import { useCallback, useEffect, useRef, useState } from 'react'
import type { WritingDraftView } from '#lib/writingVoice/draftTypes.ts'
import { legacySlackDraftMarkdown, parseChatMarkdown } from './chatMarkdown.ts'
import type { Node } from './wysiwyg/model.ts'
import { contextFor, renderExport, renderStatic } from './wysiwyg/render.ts'
import { serializeChildren } from './wysiwyg/serializer.ts'

export type DraftReplyPart = { html: string } | { draftId: string; text: string }

function draftMatchHtml(text: string): string {
  // A writer's underlined subject is often presented as bold text in the review quote.
  // Compare rendered markup, retaining the complete body, links, and literal code.
  return renderStatic(legacySlackDraftMarkdown(text) ?? text).replace(
    /^<h([1-6])>([\s\S]*?)<\/h\1>/,
    '<p><strong>$2</strong></p>',
  )
}

/** Match writer-owned text, never infer that an arbitrary quote is a draft. */
export function splitWritingDrafts(source: string, drafts: WritingDraftView[]): DraftReplyPart[] | null {
  if (!drafts.length) return null
  const doc = parseChatMarkdown(source)
  const parts: DraftReplyPart[] = []
  let blocks: Node[] = []
  let matched = false
  const normalize = (value: string) => value.replaceAll('\r\n', '\n').trim()
  const candidates = drafts.map((draft) => ({
    draft,
    texts: draft.versions.map((version) => normalize(version.text)),
  }))
  const flush = () => {
    if (blocks.length) parts.push({ html: renderExport(blocks, { ...contextFor(doc), rawAsText: true }) })
    blocks = []
  }
  for (const block of doc.blocks) {
    const text = block.type === 'blockquote' ? normalize(serializeChildren(block).join('\n')) : null
    let matches = text ? candidates.filter((entry) => entry.texts.includes(text)) : []
    if (text && !matches.length) {
      const html = draftMatchHtml(text)
      matches = candidates.filter((entry) => entry.texts.some((version) => draftMatchHtml(version) === html))
    }
    const draft = matches.length === 1 ? matches[0]!.draft : undefined
    if (draft) {
      flush()
      parts.push({ draftId: draft.id, text: text! })
      matched = true
    } else blocks.push(block)
  }
  flush()
  return matched ? parts : null
}

export async function writingDraftRequest(chatId: string, draftId: string, body: unknown): Promise<WritingDraftView> {
  const response = await fetch(`/chat/${encodeURIComponent(chatId)}/drafts/${draftId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await response.json()) as { draft: WritingDraftView; message?: string }
  if (!response.ok) throw new Error(data.message ?? 'Sky could not save this draft.')
  return data.draft
}

export function useWritingDrafts(chatId: string, refreshKey: string) {
  const [drafts, setDrafts] = useState<WritingDraftView[]>([])
  const [error, setError] = useState('')
  const generation = useRef(0)
  const update = useCallback((draft: WritingDraftView) => {
    generation.current++
    setDrafts((prior) =>
      prior.some((item) => item.id === draft.id)
        ? prior.map((item) => (item.id === draft.id ? draft : item))
        : [...prior, draft],
    )
  }, [])
  useEffect(() => {
    generation.current++
    setDrafts([])
    setError('')
  }, [chatId])
  useEffect(() => {
    if (!chatId) return
    let alive = true
    let pending = false
    const read = async () => {
      if (pending) return
      pending = true
      const at = generation.current
      try {
        const response = await fetch(`/chat/${encodeURIComponent(chatId)}/drafts`)
        if (response.status === 404) return
        const data = (await response.json()) as { drafts?: WritingDraftView[]; message?: string }
        if (!response.ok) throw new Error(data.message ?? 'Drafts could not be refreshed.')
        if (alive && at === generation.current) {
          setDrafts((prior) =>
            JSON.stringify(prior) === JSON.stringify(data.drafts ?? []) ? prior : (data.drafts ?? []),
          )
          setError('')
        }
      } catch (problem) {
        if (alive) setError((problem as Error).message)
      } finally {
        pending = false
      }
    }
    void read()
    const timer = setInterval(() => void read(), 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [chatId, refreshKey])
  return { drafts, update, error }
}

export { writingDraftDiffHtml } from './writingDraftDiff.ts'
