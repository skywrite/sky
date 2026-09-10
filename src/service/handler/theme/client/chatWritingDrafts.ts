import { diffWordsWithSpace } from 'diff'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WritingDraftView } from '#lib/writingVoice/draftTypes.ts'
import { escapeHtml } from './wysiwyg/html.ts'
import type { Node } from './wysiwyg/model.ts'
import { parseDocument } from './wysiwyg/parser.ts'
import { contextFor, renderExport } from './wysiwyg/render.ts'
import { serializeChildren } from './wysiwyg/serializer.ts'

export type DraftReplyPart = { html: string } | { draftId: string }

/** Read from the current draft to the selected version: what restoring it would change. */
export function writingDraftDiffHtml(current: string, selected: string): string {
  // A wholesale rewrite should not tie up the page looking for tiny word matches.
  const changes: { value: string; added?: boolean; removed?: boolean }[] = diffWordsWithSpace(current, selected, {
    maxEditLength: 800,
    timeout: 40,
  }) ?? [
    { value: current, removed: true },
    { value: selected, added: true },
  ]
  let html = ''
  let removedText = ''
  let addedText = ''
  const flush = () => {
    if (removedText) html += `<del>${escapeHtml(removedText)}</del>`
    if (addedText) html += `<ins>${escapeHtml(addedText)}</ins>`
    removedText = ''
    addedText = ''
  }
  for (const [index, change] of changes.entries()) {
    if (change.removed) removedText += change.value
    else if (change.added) addedText += change.value
    else {
      const next = changes[index + 1]
      // Shared spaces inside a replaced phrase belong in both readings.
      if ((removedText || addedText) && /^\s+$/.test(change.value) && (next?.added || next?.removed)) {
        removedText += change.value
        addedText += change.value
      } else {
        flush()
        html += escapeHtml(change.value)
      }
    }
  }
  flush()
  return html
}

/** Match writer-owned text, never infer that an arbitrary quote is a draft. */
export function splitWritingDrafts(source: string, drafts: WritingDraftView[]): DraftReplyPart[] | null {
  if (!drafts.length) return null
  const doc = parseDocument(source)
  const parts: DraftReplyPart[] = []
  let blocks: Node[] = []
  let matched = false
  const normalize = (value: string) => value.replaceAll('\r\n', '\n').trim()
  const flush = () => {
    if (blocks.length) parts.push({ html: renderExport(blocks, { ...contextFor(doc), rawAsText: true }) })
    blocks = []
  }
  for (const block of doc.blocks) {
    const text = block.type === 'blockquote' ? normalize(serializeChildren(block).join('\n')) : null
    const draft = text
      ? drafts.find((entry) => entry.versions.some((version) => normalize(version.text) === text))
      : undefined
    if (draft) {
      flush()
      parts.push({ draftId: draft.id })
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
