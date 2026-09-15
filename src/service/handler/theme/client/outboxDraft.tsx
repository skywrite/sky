import { Button, Textarea, TextInput } from '@mantine/core'
import { type OutboxEditor, SHORTER_DIRECTION, WARMER_DIRECTION } from './outboxItemEditor.ts'
import { OutboxText } from './outboxParts.tsx'
import { WritingDraftEditor } from './writingDraft.tsx'

/**
 * The two shapes a reply takes on its page. A decision asks the person
 * first: its questions, the ways to answer, Sky's suggestion, or a few
 * words of direction. A prepared reply shows the words and lets the person
 * refine them, alone or with Sky.
 */

function RevisionFeedback({ editor }: { editor: OutboxEditor }) {
  const { item, revisionError, revisionNotice, composing } = editor
  if (revisionError)
    return (
      <div className="sky-outbox-notice" role="alert">
        {item?.composition?.status === 'failed' && (
          <p>Your draft and instructions are saved. Sky could not finish the revision.</p>
        )}
        {revisionError}
      </div>
    )
  if (!composing && revisionNotice)
    return (
      <p className="sky-outbox-compose-feedback" role="status">
        {revisionNotice}
      </p>
    )
  return null
}

/** The server takes an instruction of at most this many characters. */
const INSTRUCTION_LIMIT = 4000

/**
 * Whether the item asks the person anything: ways to answer, and — once
 * the relevance check has confirmed the item — its questions and Sky's
 * suggestion.
 */
export function outboxAsks(editor: OutboxEditor): boolean {
  const { item, awaiting } = editor
  if (!item) return false
  return (
    Boolean(item.replyOptions?.length) || (!awaiting && (item.questions.length > 0 || Boolean(item.recommendation)))
  )
}

/** The questions, the ways to answer them, and Sky's suggestion. */
export function OutboxAsks({ editor }: { editor: OutboxEditor }) {
  const { item, awaiting, blocked } = editor
  if (!item || !outboxAsks(editor)) return null
  return (
    <>
      {!awaiting && item.questions.length > 0 && (
        <div className="sky-outbox-questions">
          {item.questions.map((question) => (
            <p key={question}>{question}</p>
          ))}
        </div>
      )}
      {Boolean(item.replyOptions?.length) && (
        <div className="sky-outbox-reply-options" aria-label="Ways to reply">
          {item.replyOptions!.map((option) => (
            <Button
              key={option.label}
              variant="default"
              disabled={blocked}
              onClick={() => void editor.compose(option.instruction)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
      {!awaiting && item.recommendation && (
        <div className="sky-outbox-recommendation">
          <span className="sky-outbox-draft-label">Sky’s suggestion</span>
          <OutboxText className="sky-outbox-recommendation-text" text={item.recommendation} />
          <Button
            size="sm"
            disabled={blocked}
            onClick={() => void editor.compose(item.recommendation!.slice(0, INSTRUCTION_LIMIT))}
          >
            Use this
          </Button>
        </div>
      )}
    </>
  )
}

export function OutboxDecision({ editor }: { editor: OutboxEditor }) {
  const { item, edit, awaiting, blocked, busy, composing } = editor
  if (!item || !edit) return null
  const asks = outboxAsks(editor)
  const label = !awaiting && item.questions.length > 0 ? 'Your decision' : 'Your reply'
  return (
    <section className="sky-outbox-decision" aria-label={label}>
      <div className="sky-outbox-draft-label">{label}</div>
      <OutboxAsks editor={editor} />
      <form
        className="sky-outbox-direction"
        onSubmit={(event) => {
          event.preventDefault()
          void editor.compose()
        }}
      >
        <TextInput
          aria-label="Direction for Sky"
          placeholder={asks ? 'Or tell Sky what to say…' : 'Tell Sky what to say…'}
          value={edit.direction ?? ''}
          maxLength={4000}
          disabled={busy}
          onChange={(event) => editor.changeDirection(event.currentTarget.value)}
        />
        <Button type="submit" variant="primary" loading={composing} disabled={blocked}>
          {composing ? 'Sky is writing…' : 'Draft reply'}
        </Button>
        <Button disabled={busy} onClick={() => editor.setManualReply(true)}>
          Write it myself
        </Button>
      </form>
      <RevisionFeedback editor={editor} />
    </section>
  )
}

export function OutboxPreparedReply({ editor }: { editor: OutboxEditor }) {
  const { item, edit, editable, busy, placing, composing, blocked } = editor
  if (!item || !edit) return null
  const label = editable
    ? 'Prepared reply'
    : item.status === 'ready'
      ? `Ready in ${editor.nativeApp}`
      : 'Approved reply'
  const hasText = edit.text.trim() !== ''
  return (
    <section className="sky-outbox-draft" aria-label="Reply editor" aria-busy={composing}>
      <div className="sky-outbox-draft-label">{label}</div>
      {item.writingDraft ? (
        <>
          <WritingDraftEditor
            key={item.writingDraft.id}
            draft={item.writingDraft}
            disabled={busy || placing}
            onEditingChange={editor.setSharedEditing}
            onAsk={editable && !item.contextError ? () => void editor.askAboutDraft() : undefined}
            onChange={() => {}}
            mutate={editor.mutateDraft}
          />
          <RevisionFeedback editor={editor} />
        </>
      ) : editable ? (
        <>
          <Textarea
            label="Reply draft"
            aria-label="Reply draft"
            autosize
            minRows={3}
            value={edit.text}
            disabled={busy}
            onChange={(event) => editor.change(event.currentTarget.value)}
          />
          <div className="sky-outbox-compose">
            <Textarea
              label="Instructions for Sky"
              description={
                hasText
                  ? 'Tell Sky what to change. Revise with Sky saves your draft and instructions, then saves the revised reply above.'
                  : 'Describe what you want to say. Sky saves your instructions and writes the reply above.'
              }
              aria-label="Direction for Sky"
              placeholder={
                hasText ? 'What would you like to change?' : 'Your decision, or the gist of what you want to say…'
              }
              value={edit.direction ?? ''}
              autosize
              minRows={2}
              maxLength={4000}
              disabled={busy}
              onChange={(event) => editor.changeDirection(event.currentTarget.value)}
            />
            <div className="sky-outbox-actions">
              <Button variant="primary" loading={composing} disabled={blocked} onClick={() => void editor.compose()}>
                {composing ? 'Sky is writing…' : hasText ? 'Revise with Sky' : 'Draft reply'}
              </Button>
              {hasText && (
                <>
                  <Button disabled={blocked} onClick={() => void editor.compose(SHORTER_DIRECTION)}>
                    Shorter
                  </Button>
                  <Button disabled={blocked} onClick={() => void editor.compose(WARMER_DIRECTION)}>
                    Warmer
                  </Button>
                </>
              )}
            </div>
            <RevisionFeedback editor={editor} />
          </div>
        </>
      ) : (
        <p className="sky-outbox-text">{item.draft}</p>
      )}
    </section>
  )
}
