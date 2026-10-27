import type { ActionVerification } from '#lib/workstreams/actionOutcome.ts'
import type { WorkstreamRecord } from '#lib/workstreams/types.ts'
import { readableReason } from './delegation.ts'
import { Evidence } from './Evidence.tsx'

export function ActionResultEvidence({
  verification,
  item,
}: {
  verification?: ActionVerification
  item: WorkstreamRecord
}) {
  if (!verification) return null
  return (
    <div className="sky-workstream-action-verification">
      <strong>
        {verification.outcome === 'accepted' ? 'Sky verified the deliverable' : 'The deliverable needs review'}
      </strong>
      <p>{verification.rationale}</p>
      {verification.reasons.length > 0 && (
        <ul>
          {verification.reasons.map((reason, index) => (
            <li key={index}>{readableReason(item, reason)}</li>
          ))}
        </ul>
      )}
      <details className="sky-workstream-disclosure">
        <summary>Evidence for this result</summary>
        {verification.artifactEvidence.map((quote, index) => (
          <blockquote key={index}>{quote}</blockquote>
        ))}
        <Evidence sources={item.sources} evidence={verification.sourceEvidence} />
      </details>
    </div>
  )
}
