import type { CoordinationProposal } from '#lib/workstreams/coordination.ts'

export function CoordinationPreview({ proposal }: { proposal: CoordinationProposal }) {
  return (
    <div className="sky-workstream-coordination">
      {!!proposal.stakeholders?.length && (
        <div>
          <strong>People</strong>
          {proposal.stakeholders.map((person, index) => (
            <p key={index}>
              {person.name}
              {person.role ? ` · ${person.role}` : ''}
              <small>
                {person.basis === 'stated' ? 'From your context' : 'Suggested'}
                {person.reason ? ` · ${person.reason}` : ''}
              </small>
            </p>
          ))}
        </div>
      )}
      {proposal.timeline && (
        <div>
          <strong>Timing</strong>
          <p>
            {proposal.timeline.start ? `Start ${proposal.timeline.start}` : ''}
            {proposal.timeline.start && proposal.timeline.due ? ' · ' : ''}
            {proposal.timeline.due ? `By ${proposal.timeline.due}` : ''}
            <small>
              {proposal.timeline.basis === 'stated' ? 'From your context' : 'Suggested'}
              {proposal.timeline.reason ? ` · ${proposal.timeline.reason}` : ''}
            </small>
          </p>
        </div>
      )}
      {!!proposal.reporting?.length && (
        <div>
          <strong>Keeping people informed</strong>
          {proposal.reporting.map((report, index) => (
            <p key={index}>
              {report.audience} · Every {report.cadenceDays} days · {report.medium}
              {report.destination ? ` · ${report.destination}` : ''}
              <small>
                {report.detail === 'summary' ? 'High-level summary' : 'Operational detail'}
                {report.artifacts.length ? ` · ${report.artifacts.join(' + ')}` : ''}
              </small>
              {report.instructions && <small>{report.instructions}</small>}
              <small>
                {report.basis === 'stated' ? 'From your context' : 'Suggested'}
                {report.reason ? ` · ${report.reason}` : ''}
              </small>
            </p>
          ))}
          <p className="sky-workstream-hint">
            After accepting, choose the sources each audience may see and how its report should be delivered.
          </p>
        </div>
      )}
      {!!proposal.metrics?.length && (
        <div>
          <strong>Measures you mentioned</strong>
          {proposal.metrics.map((metric, index) => (
            <p key={index}>
              {metric.name} · {metric.target}
              {metric.unit ? ` ${metric.unit}` : ''}
              {metric.current && <small>Current: {metric.current}</small>}
              <small>{metric.reason}</small>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
