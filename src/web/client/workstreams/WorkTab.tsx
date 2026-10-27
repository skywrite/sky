import { Button } from '@mantine/core'
import { ActivitySchema, type Activity } from '#lib/workstreams/types.ts'
import { ActivityRow } from './ActivityRow.tsx'
import { ProposalRow } from './ProposalRow.tsx'
import { complete, useWorkstreamDetail } from './WorkstreamDetailContext.ts'

export function WorkTab({
  decisions,
  delegatedDecisions,
  showCompleted,
  onShowCompletedChange,
}: {
  decisions: Activity[]
  delegatedDecisions: Activity[]
  showCompleted: boolean
  onShowCompletedChange: (show: boolean) => void
}) {
  const { item, onRelate, onSubstream, activityActions } = useWorkstreamDetail()
  const activities = item.activities.filter(
    (activity) => activity.kind !== 'decision' && !activity.subworkstreamId && (showCompleted || !complete(activity)),
  )
  const done = item.activities.filter(complete).length
  return (
    <>
      <div className="sky-workstream-brief-view-intro">
        <h3>Move the work forward</h3>
        <p>Choose an activity to see its context and actions.</p>
      </div>
      {!!item.proposals?.length && (
        <section className="sky-workstream-section">
          <h3>Sky suggests</h3>
          {item.proposals.map((proposal) => (
            <ProposalRow key={proposal.id} proposal={proposal} />
          ))}
        </section>
      )}
      {decisions.length > 0 && (
        <section className="sky-workstream-section">
          <div className="sky-workstream-section-head">
            <h3>Decisions that need you</h3>
            <span className="sky-workstream-hint">{decisions.length}</span>
          </div>
          {decisions.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
        </section>
      )}
      {delegatedDecisions.length > 0 && (
        <section className="sky-workstream-section">
          <div className="sky-workstream-section-head">
            <h3>Decisions Sky is handling</h3>
            <span className="sky-workstream-hint">{delegatedDecisions.length}</span>
          </div>
          {delegatedDecisions.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
        </section>
      )}
      <section className="sky-workstream-section">
        <div className="sky-workstream-section-head">
          <h3>Actions & follow-through</h3>
          <Button
            size="xs"
            onClick={() =>
              activityActions.edit(
                ActivitySchema.parse({
                  id: crypto.randomUUID(),
                  title: 'New action',
                  executor: item.sky.mode === 'drive' ? 'sky' : 'human',
                }),
              )
            }
          >
            ＋ Add
          </Button>
        </div>
        {activities.length ? (
          activities.map((activity) => <ActivityRow key={activity.id} activity={activity} />)
        ) : (
          <p className="sky-workstream-hint">
            Start with one useful action. You and Sky can develop the rest as the work unfolds.
          </p>
        )}
        {done > 0 && (
          <Button size="xs" onClick={() => onShowCompletedChange(!showCompleted)}>
            {showCompleted ? 'Hide completed work' : `Show ${done} completed`}
          </Button>
        )}
        {showCompleted &&
          item.activities
            .filter((activity) => activity.kind === 'decision' && complete(activity))
            .map((activity) => <ActivityRow key={activity.id} activity={activity} />)}
      </section>

      <div className="sky-workstream-structure-actions">
        <Button size="sm" onClick={onSubstream}>
          ＋ Sub-workstream
        </Button>
        <Button size="sm" onClick={() => onRelate(item.id)}>
          Relate to…
        </Button>
      </div>
    </>
  )
}
