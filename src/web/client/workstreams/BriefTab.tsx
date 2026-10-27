import { Button, Textarea } from '@mantine/core'
import { useState } from 'react'
import type { Activity } from '#lib/workstreams/types.ts'
import { ActivityRow } from './ActivityRow.tsx'
import { ProposalRow } from './ProposalRow.tsx'
import { Prose } from './Prose.tsx'
import { RelatedWork } from './RelatedWork.tsx'
import { complete, moment, useWorkstreamDetail } from './WorkstreamDetailContext.ts'
import { relationshipsFor, requiredResultAvailable } from './workstreamsRelationshipModel.ts'
import { workstreamSkyMessage } from './workstreamsSkyMessage.ts'

export function BriefTab({
  decisions,
  request,
  savedRequest,
  onRequestChange,
  onReview,
}: {
  decisions: Activity[]
  request: string
  savedRequest: string
  onRequestChange: (text: string) => void
  onReview: (noteOnly?: boolean) => void
}) {
  const { item, all, runs, communications, busy, onRelate, openEditor, openArtifact, showView } = useWorkstreamDetail()
  const currentRun = runs.find((run) => run.status === 'running')
  const needsReview = item.activities.find(
    (activity) =>
      !complete(activity) &&
      !!activity.outboxId &&
      communications.some(
        (value) => value.id === activity.outboxId && (value.status === 'needs_review' || value.stale),
      ),
  )
  const attention = decisions[0] ?? needsReview
  const nextAction = item.activities.find(
    (activity) =>
      activity.id !== attention?.id &&
      activity.kind !== 'decision' &&
      !activity.subworkstreamId &&
      !complete(activity) &&
      activity.state !== 'waiting' &&
      activity.requires.every((requirement) => requiredResultAvailable(requirement, all)),
  )
  const relatedWork = relationshipsFor(item, all)
  const relationProposal = item.proposals?.find((proposal) => proposal.kind === 'relation')
  const latestArtifact = item.artifacts.at(-1)
  const skyMessage = workstreamSkyMessage(item.sky, runs)
  const skyActivity = item.activities.find(
    (activity) =>
      !complete(activity) &&
      activity.executor === 'sky' &&
      (activity.state === 'running' || activity.state === 'waiting'),
  )
  return (
    <>
      <section className="sky-workstream-outcome">
        <div className="sky-workstream-section-head">
          <h3>What success looks like</h3>
          <Button size="xs" onClick={() => openEditor('overview')}>
            Edit
          </Button>
        </div>
        <BriefOutcome
          text={
            item.outcome ||
            item.intent ||
            'Describe what you want to accomplish. The outcome can become clearer as you go.'
          }
        />
        {item.due && <span className="sky-workstream-date">By {item.due}</span>}
        {item.state !== 'active' && <span className="sky-workstream-date">{item.state}</span>}
      </section>
      <section className="sky-workstream-section sky-workstream-brief-status">
        <h3>Where things stand</h3>
        {item.understanding ? (
          <BriefProse text={item.understanding} />
        ) : (
          <p className="sky-workstream-hint">
            No update recorded yet. Share what you know below to start shaping the work.
          </p>
        )}
      </section>
      {attention || nextAction ? (
        <section className="sky-workstream-section sky-workstream-brief-next">
          {attention && (
            <>
              <h3>Needs you</h3>
              <ActivityRow key={attention.id} activity={attention} />
            </>
          )}
          {!attention && nextAction && (
            <>
              <h3>Next move</h3>
              <ActivityRow key={nextAction.id} activity={nextAction} />
            </>
          )}
          <Button size="xs" onClick={() => showView('work')}>
            View all work
          </Button>
        </section>
      ) : (
        <section className="sky-workstream-section">
          <div className="sky-workstream-section-head">
            <h3>Next move</h3>
            <Button size="xs" onClick={() => showView('work')}>
              View all work
            </Button>
          </div>
          <p className="sky-workstream-hint">
            {item.activities.some((activity) => !complete(activity))
              ? 'Work is waiting. Open the activities to see the inputs or decisions needed.'
              : item.activities.length
                ? 'The recorded activities are finished. Review whether the outcome has been achieved.'
                : 'Add one useful action, or ask Sky to help find the next move.'}
          </p>
        </section>
      )}
      <section className="sky-workstream-sky sky-workstream-brief-sky">
        <div className="sky-workstream-section-head">
          <h3>
            <span className="sky-workstream-sky-mark">✦</span>
            {currentRun ? 'Sky is working' : 'Sky'}
          </h3>
          <Button size="xs" onClick={() => openEditor('sky')}>
            {item.sky.mode === 'off' ? 'Give responsibility' : 'Responsibility'}
          </Button>
        </div>
        {currentRun ? (
          <p>Review started {moment(currentRun.started)}. Results will appear here when it finishes.</p>
        ) : skyMessage.summary ? (
          <BriefProse text={skyMessage.summary} />
        ) : skyMessage.error ? null : skyActivity ? (
          <p>
            {skyActivity.state === 'waiting' ? `Waiting for ${skyActivity.waitingFor || 'an input'}` : 'Working on'}:{' '}
            {skyActivity.title}
          </p>
        ) : (
          <p>
            {item.sky.mode === 'off'
              ? 'Ask Sky to help with a next move. Ongoing help is off.'
              : 'Ongoing help is enabled. No review result has been recorded yet.'}
          </p>
        )}
        {skyMessage.error && <p className="sky-workstreams-error">{skyMessage.error}</p>}
        {latestArtifact && (
          <button
            className="sky-workstream-artifact"
            type="button"
            disabled={busy}
            onClick={() => openArtifact(latestArtifact)}
          >
            <span aria-hidden="true">▤</span>
            <span>
              <strong>{latestArtifact.title}</strong>
              <small>Prepared work · {moment(latestArtifact.created)}</small>
            </span>
            <span aria-hidden="true">↗</span>
          </button>
        )}
        <Textarea
          aria-label="What changed, or what would you like to move forward?"
          placeholder="What changed, or what would you like to move forward?"
          autosize
          minRows={2}
          maxRows={6}
          maxLength={20000}
          value={request}
          disabled={busy}
          onChange={(event) => onRequestChange(event.currentTarget.value)}
        />
        {savedRequest && request.trim() === savedRequest && (
          <p className="sky-workstream-hint" role="status">
            Your note is saved. You can retry asking Sky without saving it again.
          </p>
        )}
        <div className="sky-workstream-brief-actions">
          <Button variant="primary" size="sm" disabled={busy || !!currentRun} onClick={() => onReview()}>
            {request.trim() ? 'Send to Sky' : 'Review this workstream'}
          </Button>
          <Button size="sm" disabled={busy || !request.trim()} onClick={() => onReview(true)}>
            Save note only
          </Button>
        </div>
      </section>
      <section className="sky-workstream-section sky-workstream-brief-relations">
        <div className="sky-workstream-section-head">
          <h3>The wider picture</h3>
          <Button size="xs" onClick={() => onRelate(item.id)}>
            Relate to…
          </Button>
        </div>
        {relatedWork.length ? (
          <RelatedWork limit={3} />
        ) : (
          <p className="sky-workstream-hint">Connect this outcome to work it supports or needs a result from.</p>
        )}
        {relatedWork.length > 3 && (
          <Button size="xs" onClick={() => showView('details')}>
            View all {relatedWork.length} relationships
          </Button>
        )}
        {relationProposal && <ProposalRow proposal={relationProposal} />}
      </section>
    </>
  )
}

function BriefOutcome({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 140 || text.includes('\n')
  return (
    <div className="sky-workstream-brief-outcome-text">
      <p className={long && !expanded ? 'sky-workstream-brief-clamped' : undefined}>{text}</p>
      {long && (
        <Button size="xs" variant="primary-quiet" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Read full outcome'}
        </Button>
      )}
    </div>
  )
}

function BriefProse({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 280 || text.split('\n').length > 3
  return (
    <div className="sky-workstream-brief-prose">
      <div className={long && !expanded ? 'sky-workstream-brief-clamped' : undefined}>
        <Prose text={text} />
      </div>
      {long && (
        <Button size="xs" variant="primary-quiet" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Read full update'}
        </Button>
      )}
    </div>
  )
}
