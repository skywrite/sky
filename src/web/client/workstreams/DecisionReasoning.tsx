import type { WorkstreamRecord } from '#lib/workstreams/types.ts'
import { type DecisionWork, readableReason } from './delegation.ts'
import { Evidence } from './Evidence.tsx'

export function DecisionReasoning({ activity, item }: { activity: DecisionWork; item: WorkstreamRecord }) {
  const record = activity.decisionResolution ?? activity.decisionAnalysis
  const assumptions = record?.assumptions ?? activity.decisionAssumptions ?? []
  return (
    <div className="sky-workstream-decision-reasoning">
      {activity.notes && <p className="sky-workstream-decision-context">{activity.notes}</p>}
      {record?.outcome === 'resolved' && (
        <p className="sky-workstream-decision-attribution">
          Sky decided {record.choiceLabel || record.recommendation} · {record.at.replace('T', ' ').slice(0, 16)}
        </p>
      )}
      {record && (
        <>
          <p>
            <strong>Why</strong> {record.rationale}
          </p>
          {record.outcome === 'escalated' && (
            <div className="sky-workstream-decision-escalation">
              <strong>Needs your judgment</strong>
              <ul>
                {record.reasons.map((reason, index) => (
                  <li key={index}>{readableReason(item, reason)}</li>
                ))}
              </ul>
            </div>
          )}
          {!!record.contradictions.length && (
            <div className="sky-workstream-decision-escalation">
              <strong>Conflicting information</strong>
              <ul>
                {record.contradictions.map((contradiction, index) => (
                  <li key={index}>{contradiction}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {!!assumptions.length && (
        <div className="sky-workstream-assumptions">
          <strong>Assumptions</strong>
          {assumptions.map((assumption) => (
            <p key={assumption.id}>
              <span data-status={assumption.status}>
                {assumption.status === 'confirmed'
                  ? 'Confirmed'
                  : assumption.status === 'rejected'
                    ? 'Rejected'
                    : 'Unconfirmed'}
              </span>
              {assumption.statement}
            </p>
          ))}
        </div>
      )}
      {record && (
        <details className="sky-workstream-disclosure">
          <summary>Options, evidence & stakeholder input</summary>
          {record.options.map((option) => (
            <div className="sky-workstream-decision-option" key={option.id}>
              <strong>{option.label}</strong>
              {option.advantages.map((value, index) => (
                <p key={`pro-${index}`}>＋ {value}</p>
              ))}
              {option.disadvantages.map((value, index) => (
                <p key={`con-${index}`}>− {value}</p>
              ))}
            </div>
          ))}
          <Evidence sources={item.sources} evidence={record.evidence} />
          {!!record.stakeholderEvidence.length && (
            <>
              <strong>Stakeholder input</strong>
              {record.stakeholderEvidence.map((entry, index) => (
                <div key={`${entry.stakeholderId}-${index}`}>
                  <p>{item.stakeholders.find((person) => person.id === entry.stakeholderId)?.name ?? 'Stakeholder'}</p>
                  <Evidence sources={item.sources} evidence={[entry]} />
                </div>
              ))}
            </>
          )}
          {!!record.risks.length && (
            <>
              <strong>Risks considered</strong>
              <ul>
                {record.risks.map((risk, index) => (
                  <li key={index}>{risk}</li>
                ))}
              </ul>
            </>
          )}
          <p className="sky-workstream-hint">
            Sky’s confidence in this assessment: {Math.round(record.confidence * 100)}%.
          </p>
        </details>
      )}
    </div>
  )
}
