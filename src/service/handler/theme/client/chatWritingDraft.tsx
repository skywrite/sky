import { Fragment, useMemo } from 'react'
import type { WritingDraftView } from '#lib/writingVoice/draftTypes.ts'
import { splitWritingDrafts, writingDraftRequest } from './chatWritingDrafts.ts'
import { RenderedHtml } from './renderedHtml.tsx'
import { WritingDraftEditor } from './writingDraft.tsx'

export const writingDraftAnchor = (chatId: string, id: string) => `writing-draft-${chatId}-${id}`

export function ChatWritingDraft({
  chatId,
  draft,
  ...props
}: {
  key?: string
  chatId: string
  draft: WritingDraftView
  disabled?: boolean
  onChange: (draft: WritingDraftView) => void
  onAsk?: (draft: WritingDraftView) => void
}) {
  return (
    <WritingDraftEditor
      {...props}
      draft={draft}
      legacy={draft.legacy}
      anchor={writingDraftAnchor(chatId, draft.id)}
      mutate={(body) => writingDraftRequest(chatId, draft.id, body)}
    />
  )
}

export function WritingDraftReply({
  content,
  html,
  chatId,
  drafts,
  placed,
  disabled,
  onChange,
  onAsk,
}: {
  content: string
  html?: string
  chatId: string
  drafts: WritingDraftView[]
  placed: WritingDraftView[]
  disabled?: boolean
  onChange: (draft: WritingDraftView) => void
  onAsk?: (draft: WritingDraftView) => void
}) {
  const parts = useMemo(() => splitWritingDrafts(content, drafts), [content, drafts])
  const shown = new Set<string>()
  const card = (draft: WritingDraftView) => (
    <ChatWritingDraft chatId={chatId} draft={draft} onChange={onChange} onAsk={onAsk} disabled={disabled} />
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
          const draft = placed.find((item) => item.id === part.draftId)
          if (draft && !shown.has(draft.id)) {
            shown.add(draft.id)
            return <Fragment key={draft.id}>{card(draft)}</Fragment>
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
      {placed
        .filter((draft) => !shown.has(draft.id))
        .map((draft) => (
          <Fragment key={draft.id}>{card(draft)}</Fragment>
        ))}
    </>
  )
}
