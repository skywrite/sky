import { Button } from '@mantine/core'
import { ActivitySchema, type Activity } from '#lib/workstreams/types.ts'
import { outboxHref } from '../outbox/outboxRoutes.ts'
import { ActionResultEvidence } from './ActionResultEvidence.tsx'
import { DecisionReasoning } from './DecisionReasoning.tsx'
import { Prose } from './Prose.tsx'
import { requiredResultAvailable } from './relationshipModel.ts'
import { complete, useWorkstreamDetail, type WorkstreamCommunication } from './WorkstreamDetailContext.ts'

function communicationStatus(value: WorkstreamCommunication): string {
  if (value.delivery) return 'Owner reported sent'
  if (value.status === 'placement_unknown') return 'Placement uncertain'
  if (value.status === 'placing') return 'Preparing native draft'
  if (value.stale) return 'Context changed · Review needed'
  if (value.status === 'ready')
    return value.native ? 'Native draft ready · Sending unconfirmed' : 'Draft prepared · Sending unconfirmed'
  return value.status === 'dismissed' ? 'Dismissed' : 'Needs review'
}

export function ActivityRow({ activity }: { activity: Activity }) {
  const {
    item,
    all,
    runs,
    communications,
    busy,
    navigate,
    onSelect,
    expandedActivity,
    expandActivity,
    highlightedActivity,
    activityActions: actions,
  } = useWorkstreamDetail()
  const currentRun = runs.find((run) => run.status === 'running')
  const expanded = expandedActivity === activity.id
  const missingResults = activity.requires.filter((requirement) => !requiredResultAvailable(requirement, all))
  const waitingFor = activity.waitingFor || missingResults[0]?.result
  return (
    <div
      id={`activity-${activity.id}`}
      className="sky-workstream-activity sky-workstream-brief-activity"
      data-done={complete(activity)}
      data-highlight={highlightedActivity === activity.id}
      data-expanded={expanded}
    >
      <div className="sky-workstream-activity-heading">
        <span className="sky-workstream-activity-symbol" aria-hidden="true">
          {complete(activity) ? '✓' : activity.kind === 'decision' ? '◇' : '○'}
        </span>
        <button
          type="button"
          className="sky-workstream-activity-title"
          aria-expanded={expanded}
          aria-controls={`activity-detail-${activity.id}`}
          onClick={() => expandActivity(expanded ? null : activity.id)}
        >
          {activity.title}
        </button>
        <span className="sky-workstream-activity-owner">
          {activity.kind === 'decision'
            ? item.sky.decisionPolicies[activity.id]?.mode === 'delegate'
              ? 'Sky'
              : activity.person || 'You'
            : activity.executor === 'sky'
              ? 'Sky'
              : activity.person || 'You'}
        </span>
      </div>
      {!expanded && waitingFor && <p className="sky-workstream-hint">Waiting for {waitingFor}</p>}
      {!expanded && (
        <div className="sky-workstream-brief-activity-action">
          <span>{activity.due ? `By ${activity.due}` : activity.state === 'ready' ? '' : activity.state}</span>
          {complete(activity) ? (
            <Button size="xs" onClick={() => expandActivity(activity.id)}>
              View result
            </Button>
          ) : activity.state === 'proposed' ? (
            <Button size="xs" variant="primary-quiet" disabled={busy} onClick={() => actions.accept(activity)}>
              Accept next step
            </Button>
          ) : activity.outboxId ? (
            <Button size="xs" variant="primary-quiet" onClick={() => navigate(outboxHref(activity.outboxId!))}>
              Open in Outbox ↗
            </Button>
          ) : missingResults.length > 0 ? (
            <Button size="xs" variant="primary-quiet" onClick={() => expandActivity(activity.id)}>
              View prerequisite
            </Button>
          ) : activity.kind === 'decision' ? (
            <Button size="xs" variant="primary-quiet" disabled={busy} onClick={() => expandActivity(activity.id)}>
              Review decision
            </Button>
          ) : activity.executor === 'sky' ? (
            <Button
              size="xs"
              variant="primary-quiet"
              disabled={busy || !!currentRun}
              onClick={() => actions.advance(activity)}
            >
              Ask Sky to advance
            </Button>
          ) : (
            <Button size="xs" variant="primary-quiet" onClick={() => actions.planToday(activity)} disabled={busy}>
              {activity.participation.some((entry) => !entry.removed) ? 'Plan for today' : 'Today'}
            </Button>
          )}
        </div>
      )}
      <div id={`activity-detail-${activity.id}`} hidden={!expanded}>
        {activity.recommendation && (
          <p className="sky-workstream-recommendation">
            <strong>Recommendation</strong> {activity.recommendation}
          </p>
        )}
        {activity.waitingFor && <p className="sky-workstream-hint">Waiting for {activity.waitingFor}</p>}
        {activity.kind === 'decision' && <DecisionReasoning activity={activity} item={item} />}
        {activity.kind !== 'decision' && (
          <ActionResultEvidence verification={activity.actionVerification} item={item} />
        )}
        {activity.result && (
          <div className="sky-workstream-result">
            <Prose text={activity.result} />
          </div>
        )}
        {activity.outboxId && communications.find((value) => value.id === activity.outboxId) && (
          <p className="sky-workstream-hint">
            Communication: {communicationStatus(communications.find((value) => value.id === activity.outboxId)!)}
          </p>
        )}
        {activity.requires.length > 0 && (
          <div className="sky-workstream-requires">
            {activity.requires.map((requirement) => {
              const workstream = all.find((candidate) => candidate.id === requirement.workstreamId),
                dependency = workstream?.activities.find((candidate) => candidate.id === requirement.activityId)
              return (
                <button
                  key={`${requirement.workstreamId}:${requirement.activityId}`}
                  type="button"
                  onClick={() => onSelect(requirement.workstreamId)}
                >
                  {requiredResultAvailable(requirement, all) ? '✓' : '↳'} Requires{' '}
                  {requirement.result || dependency?.title || 'a result'}
                  {workstream ? ` · ${workstream.title}` : ''}
                </button>
              )
            })}
          </div>
        )}
        <div className="sky-workstream-activity-foot">
          <span>
            {activity.state === 'ready' ? '' : activity.state}
            {activity.due
              ? `${activity.state === 'ready' ? '' : ' · '}By ${activity.due}`
              : activity.start
                ? ` · ${activity.start}${activity.end ? ` → ${activity.end}` : ''}`
                : ''}
          </span>
          <div>
            {activity.decisionResolution && (
              <Button
                size="xs"
                onClick={() =>
                  actions.edit(
                    ActivitySchema.parse({
                      id: crypto.randomUUID(),
                      title: `Reconsider: ${activity.title}`.slice(0, 500),
                      kind: 'decision',
                      outcome: activity.outcome,
                      notes: `Previous decision: ${activity.result}\n\nDescribe what changed and why this decision needs reconsideration.`,
                    }),
                  )
                }
              >
                Reconsider
              </Button>
            )}
            {activity.kind === 'decision' && !complete(activity) && (
              <Button size="xs" onClick={() => actions.chooseDecider(activity)}>
                Who decides
              </Button>
            )}
            {activity.kind !== 'decision' && activity.executor === 'sky' && !complete(activity) && (
              <Button size="xs" onClick={() => actions.defineDone(activity)}>
                {item.sky.actionPolicies[activity.id] ? 'Completion rule' : 'Define done'}
              </Button>
            )}
            {activity.state === 'proposed' && (
              <Button size="xs" variant="primary" disabled={busy} onClick={() => actions.accept(activity)}>
                Accept next step
              </Button>
            )}
            {!complete(activity) && (
              <Button size="xs" onClick={() => actions.planToday(activity)} disabled={busy}>
                {activity.participation.some((entry) => !entry.removed) ? 'Plan for today' : 'Today'}
              </Button>
            )}
            {activity.outboxId ? (
              <Button size="xs" onClick={() => navigate(outboxHref(activity.outboxId!))}>
                Open in Outbox ↗
              </Button>
            ) : (
              <Button size="xs" onClick={() => actions.prepareMessage(activity)}>
                Prepare message
              </Button>
            )}
            <Button size="xs" onClick={() => actions.edit(activity)}>
              Edit activity
            </Button>
            <Button size="xs" disabled={busy} onClick={() => actions.expand(activity)}>
              Expand into sub-workstream
            </Button>
          </div>
        </div>
        {!activity.decisionResolution && (
          <Button
            size="xs"
            disabled={busy}
            aria-label={complete(activity) ? `Reopen ${activity.title}` : `Complete ${activity.title}`}
            onClick={() => (complete(activity) ? actions.reopen(activity) : actions.record(activity))}
          >
            {complete(activity)
              ? 'Reopen activity'
              : activity.kind === 'decision'
                ? 'Record decision'
                : 'Record result'}
          </Button>
        )}
      </div>
    </div>
  )
}
