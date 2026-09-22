import { Button } from '@mantine/core'
import { Fragment, useEffect, useMemo, useState } from 'react'
import type { WritingDraftView } from '#lib/writingVoice/draftTypes.ts'
import { splitWritingDrafts, writingDraftRequest } from './chatWritingDrafts.ts'
import { RenderedHtml } from './renderedHtml.tsx'
import { WritingDraftEditor } from './writingDraft.tsx'
import { renderStatic } from './wysiwyg/render.ts'

export const writingDraftAnchor = (chatId: string, id: string) => `writing-draft-${chatId}-${id}`

export function ChatWritingDraft({
  chatId,
  draft,
  snapshot,
  onChange,
  ...props
}: {
  key?: string
  chatId: string
  draft: WritingDraftView
  snapshot?: string
  disabled?: boolean
  /** The first use saves an unsaved draft under its own id; `shownId` names the frame it replaces. */
  onChange: (draft: WritingDraftView, shownId?: string) => void
  onAsk?: (draft: WritingDraftView) => void
}) {
  if (snapshot !== undefined) return <WritingDraftSnapshot draft={draft} text={snapshot} />
  return (
    <WritingDraftEditor
      {...props}
      draft={draft}
      unsaved={draft.unsaved}
      anchor={writingDraftAnchor(chatId, draft.id)}
      onChange={(next) => onChange(next, draft.id)}
      mutate={(body) => writingDraftRequest(chatId, draft.id, body)}
    />
  )
}

function WritingDraftSnapshot({ draft, text }: { draft: WritingDraftView; text: string }) {
  const html = useMemo(() => renderStatic(text), [text])
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (copy === 'idle') return
    const timer = setTimeout(() => setCopy('idle'), 1800)
    return () => clearTimeout(timer)
  }, [copy])
  return (
    <section
      className="sky-writing-draft"
      aria-label={`Earlier draft${draft.input.recipient ? ` to ${draft.input.recipient}` : ''}`}
    >
      <header className="sky-writing-draft-head">
        <div>
          <strong>Draft</strong>
          <span>
            {draft.input.medium}
            {draft.input.recipient ? ` · ${draft.input.recipient}` : ''}
          </span>
        </div>
        <span className="sky-writing-draft-version">Earlier version</span>
      </header>
      <RenderedHtml className="sky-writing-draft-body sky-rendered" html={html} />
      <div className="sky-writing-draft-actions">
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(
              () => setCopy('copied'),
              () => setCopy('failed'),
            )
          }}
        >
          {copy === 'copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {copy === 'failed' && (
        <p className="sky-writing-draft-error" role="alert">
          Copy failed. You can select and copy the draft text.
        </p>
      )}
    </section>
  )
}

export function WritingDraftReply({
  content,
  html,
  chatId,
  drafts,
  placed,
  turnIndex,
  replyMode,
  disabled,
  onChange,
  onAsk,
}: {
  content: string
  html?: string
  chatId: string
  drafts: WritingDraftView[]
  placed: WritingDraftView[]
  turnIndex: number
  replyMode: boolean
  disabled?: boolean
  onChange: (draft: WritingDraftView, shownId?: string) => void
  onAsk?: (draft: WritingDraftView) => void
}) {
  const parts = useMemo(() => splitWritingDrafts(content, drafts), [content, drafts])
  const placedIds = new Set(placed.map((draft) => draft.id))
  const shown = new Set<string>()
  const card = (draft: WritingDraftView, snapshot?: string) => (
    <ChatWritingDraft
      chatId={chatId}
      draft={draft}
      snapshot={snapshot}
      onChange={onChange}
      onAsk={onAsk}
      disabled={disabled}
    />
  )
  return (
    <>
      {parts ? (
        parts.map((part, index) => {
          if ('html' in part)
            return (
              <Fragment key={`text-${index}`}>
                <RenderedHtml className="sky-body sky-rendered" html={part.html} />
              </Fragment>
            )
          const draft = drafts.find((item) => item.id === part.draftId)!
          const current = placedIds.has(part.draftId)
          if (!replyMode || current) {
            if (shown.has(draft.id)) return null
            shown.add(draft.id)
            return <Fragment key={draft.id}>{card(draft, current ? undefined : part.text)}</Fragment>
          }
          return (
            <p key={`draft-${index}`} className="sky-writing-draft-reference">
              <a href={`#${writingDraftAnchor(chatId, part.draftId)}`}>View current draft ↑</a>
            </p>
          )
        })
      ) : html ? (
        <RenderedHtml className="sky-body sky-rendered" html={html} />
      ) : (
        <div className="sky-body sky-writing-draft-fallback">{content}</div>
      )}
      {drafts
        .filter((draft) => placedIds.has(draft.id) || (!replyMode && draft.turn * 2 - 1 === turnIndex))
        .filter((draft) => !shown.has(draft.id))
        .map((draft) => (
          <Fragment key={draft.id}>
            {card(draft, placedIds.has(draft.id) ? undefined : draft.versions[0]!.text)}
          </Fragment>
        ))}
    </>
  )
}
