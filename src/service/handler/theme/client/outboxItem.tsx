import { Button, Checkbox, Textarea } from '@mantine/core'
import { useEffect, useRef } from 'react'
import { OutboxConversation } from './outboxConversation.tsx'
import { OutboxAsks, OutboxDecision, OutboxPreparedReply, outboxAsks } from './outboxDraft.tsx'
import type { OutboxEditor } from './outboxItemEditor.ts'
import { outboxLinkClick } from './outboxLink.tsx'
import { newMessageCount } from './outboxMessages.ts'
import { OutboxText } from './outboxParts.tsx'
import {
  outboxDone,
  outboxHeading,
  outboxSourceLink,
  outboxToken,
  outboxWhere,
  outboxWho,
} from './outboxPresentation.ts'
import { outboxHref } from './outboxRoutes.ts'
import { askedAt, askedLabel, waitingLabel } from './outboxTime.ts'
import { WritingVoiceQuestions } from './writingVoice.tsx'

/**
 * One item's page: the facts, the heading, one banner for what has
 * changed, the brief, the reply, the actions, and the conversation
 * underneath.
 */

function showConversation() {
  document.getElementById('outbox-conversation')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

/**
 * What changed, the most pressing first: a conflict, a context problem,
 * new messages, or Sky still writing — one of those at a time. A draft
 * being placed and a follow-up that failed each keep their own notice,
 * because each carries something the person must do.
 */
function OutboxBanner({ editor, newMessages }: { editor: OutboxEditor; newMessages: number }) {
  const { item } = editor
  if (!item) return null
  const pressing = editor.conflicted
    ? 'conflict'
    : item.contextError
      ? 'context'
      : item.stale
        ? 'stale'
        : editor.composing
          ? 'composing'
          : null
  return (
    <>
      {pressing === 'conflict' && (
        <div className="sky-outbox-notice" role="status">
          This decision changed while you were editing. Your text is preserved.
          <Button size="sm" onClick={editor.reviewLatest}>
            Review latest context with my text
          </Button>
        </div>
      )}
      {pressing === 'context' && (
        <div className="sky-outbox-notice" role="alert">
          {item.contextError}
        </div>
      )}
      {pressing === 'stale' && (
        <div className="sky-outbox-notice" data-tone="warn" role="status">
          {newMessages
            ? `${newMessages} new ${newMessages === 1 ? 'message' : 'messages'} arrived after this reply was written.`
            : 'The context changed after this reply was written. Your draft is preserved.'}
          <Button size="sm" onClick={showConversation}>
            {newMessages ? 'Read them' : 'Read the conversation'}
          </Button>
        </div>
      )}
      {pressing === 'composing' && (
        <p className="sky-outbox-notice" role="status">
          {editor.revisionNotice}
        </p>
      )}
      {editor.placing && (
        <div className="sky-outbox-notice">
          {item.status === 'placing'
            ? 'Saving your approved draft. If this was interrupted, check the native app before creating another.'
            : 'Draft placement could not be confirmed. Check the native app; Sky will not retry automatically.'}
          {item.placementError && <p>{item.placementError}</p>}
        </div>
      )}
      {item.followupError && (
        <div className="sky-outbox-notice" role="alert">
          Your reply is saved. Sky could not finish its follow-up drafts.
          <p>{item.followupError}</p>
          <Button
            size="sm"
            disabled={editor.busy || editor.followupsPending}
            onClick={() => void editor.retryFollowups()}
          >
            Retry follow-up drafts
          </Button>
        </div>
      )}
    </>
  )
}

export function OutboxItemPage({
  editor,
  today,
  open,
  railShown,
}: {
  editor: OutboxEditor
  today: string
  /** Opens a related item's page. */
  open: (id: string) => void
  /** Whether the rail is beside the page; folded, its voice questions move into the column. */
  railShown: boolean
}) {
  const { item, edit } = editor
  const feedback = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (editor.error || editor.approvalFeedback)
      feedback.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [editor.error, editor.approvalFeedback])
  if (!item || !edit)
    return (
      <div className="sky-outbox-item">
        {editor.itemError ? (
          <div className="sky-outbox-notice" role="alert">
            {editor.itemError}
          </div>
        ) : (
          <p className="sky-outbox-meta">Loading…</p>
        )}
      </div>
    )
  const asked = askedAt(item)
  const done = outboxDone(item)
  const token = outboxToken(item, { awaiting: editor.awaiting, unsavedDraft: edit.text })
  const who = outboxWho(item)
  const where = outboxWhere(item)
  const hasText = edit.text.trim() !== ''
  // The shared editor shows a draft whether or not a notebook record of it exists yet.
  const sharedDraft = Boolean(item.writingDraft ?? item.unsavedDraft)
  const decision = editor.editable && !sharedDraft && !hasText && !editor.manualReply
  // A prepared reply can still carry a decision: the questions stay in view above the words.
  const asksAbove = !decision && editor.editable && outboxAsks(editor)
  const appLink = item.native?.url || outboxSourceLink(item)
  const hint = item.delivery
    ? 'You recorded this message as sent.'
    : !editor.hasDestination
      ? 'Copy this draft into the intended app. After sending it yourself, record the result here.'
      : item.status === 'ready'
        ? 'Your draft is waiting in the app. You review and press Send there.'
        : 'Approve here to place this wording in the app. You press Send there.'
  return (
    <article className="sky-outbox-item">
      <div className="sky-outbox-facts">
        <span className="sky-outbox-meta">
          {where}
          {who !== where ? ` · ${who}` : ''} · asked {askedLabel(asked)}
          {!done && today ? ` · waiting ${waitingLabel(asked, today)}` : ''}
        </span>
        <span className="sky-outbox-token" data-tone={token.tone}>
          {token.label}
        </span>
      </div>
      <h1>{outboxHeading(item)}</h1>
      <OutboxBanner editor={editor} newMessages={newMessageCount(item)} />
      {editor.awaiting && (
        <p className="sky-outbox-notice">
          Awaiting the relevance check. This earlier result has not established that you owe a response.
        </p>
      )}
      <OutboxText className="sky-outbox-situation" text={item.situation} />
      {item.conversation.limitations.map((limitation) => (
        <p className="sky-outbox-meta" key={limitation}>
          {limitation}
        </p>
      ))}
      {asksAbove && (
        <section className="sky-outbox-decision" aria-label="Your decision">
          <div className="sky-outbox-draft-label">Your decision</div>
          <OutboxAsks editor={editor} />
        </section>
      )}
      {decision ? <OutboxDecision editor={editor} /> : <OutboxPreparedReply editor={editor} />}
      {item.stale && editor.editable && (
        <Checkbox
          checked={editor.reviewedChanges}
          onChange={(event) => editor.setReviewedChanges(event.currentTarget.checked)}
          label="I’ve reviewed the changed context"
        />
      )}
      <div className="sky-outbox-actions">
        {editor.editable && editor.hasDestination && (
          <Button
            variant="primary"
            loading={editor.approving}
            disabled={!editor.canApprove}
            onClick={() => void editor.approve()}
          >
            {editor.approving
              ? `Saving in ${editor.nativeApp}…`
              : item.native
                ? 'Approve update in app'
                : `Approve draft in ${editor.nativeApp}`}
          </Button>
        )}
        {item.status === 'needs_review' && !sharedDraft && (
          <Button
            disabled={editor.busy || editor.conflicted || edit.text === edit.saved}
            onClick={() => void editor.save()}
          >
            Save edit
          </Button>
        )}
        {sharedDraft && editor.editable && !item.contextError && (
          <Button disabled={editor.busy} onClick={() => void editor.askAboutDraft()}>
            Ask about this draft
          </Button>
        )}
        {appLink && (
          <Button component="a" href={appLink} target="_blank" rel="noreferrer">
            Open {editor.nativeApp} ↗
          </Button>
        )}
        {editor.beeper && (
          <Button disabled={editor.busy} onClick={() => void editor.openApp()}>
            Open in Beeper
          </Button>
        )}
        {!sharedDraft && hasText && <Button onClick={editor.copyReply}>Copy reply</Button>}
        {!done && (
          <Button
            variant="primary-quiet"
            disabled={editor.busy || item.status === 'placing'}
            onClick={() => void editor.dismiss()}
          >
            {item.status === 'needs_review' ? 'Dismiss' : 'Archive'}
          </Button>
        )}
        {!done && !editor.placing && hasText && (
          <Button
            variant="primary-quiet"
            disabled={editor.busy || editor.sharedEditing || editor.conflicted || edit.text !== edit.saved}
            onClick={() => editor.setSentReport(editor.sentReport === null ? '' : null)}
          >
            Record that I sent it
          </Button>
        )}
      </div>
      {(editor.error || editor.approvalFeedback) && (
        <div ref={feedback} className="sky-outbox-notice" role={editor.error ? 'alert' : 'status'}>
          {editor.error || editor.approvalFeedback}
        </div>
      )}
      {editor.sentReport !== null && (
        <section className="sky-outbox-sent">
          <Textarea
            label="Where and when did you send it?"
            description="This records your report and removes the draft from review. It does not send a message."
            value={editor.sentReport}
            onChange={(event) => editor.setSentReport(event.currentTarget.value)}
            autosize
            minRows={2}
          />
          <Button disabled={editor.busy || !editor.sentReport.trim()} onClick={() => void editor.submitSentReport()}>
            Save sent report
          </Button>
        </section>
      )}
      <p className="sky-outbox-meta sky-outbox-hint">{hint}</p>
      {!railShown && <WritingVoiceQuestions key={item.id} source={`outbox:${item.id}`} refreshKey={item.revision} />}
      {Boolean(item.followups?.length) && !editor.placing && (
        <section className="sky-outbox-followups" aria-label="Follow-up messages">
          <h3>Following through</h3>
          <p className="sky-outbox-meta">Messages prepared from your approved reply.</p>
          <div className="sky-outbox-actions">
            {item.followups!.map((followup) => (
              <Button
                key={followup.id}
                component="a"
                href={outboxHref(followup.id)}
                onClick={outboxLinkClick(open, followup.id)}
              >
                Message to {followup.recipient} ↗
              </Button>
            ))}
          </div>
        </section>
      )}
      {!sharedDraft && item.originalDraft && item.originalDraft !== edit.text && (
        <details className="sky-outbox-original">
          <summary>Sky’s original draft</summary>
          <p className="sky-outbox-text">{item.originalDraft}</p>
        </details>
      )}
      <OutboxConversation item={item} open={open} />
    </article>
  )
}
