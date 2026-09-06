import { Fragment } from 'react'
import { formatTokens, totalInput, type TokenUsage } from '#universal/ai/tokenUsage.ts'

interface Detail {
  label: string
  value: string
}

const TIMING_LABELS: Record<string, string> = {
  model: 'Model',
  tools: 'Tools',
  overlapping: 'Overlapping',
  other: 'Other work',
}

/** Thread read-back carries timingLine's formatted text; preserve unfamiliar parts as recorded. */
function timingDetails(timing: string): Detail[] {
  return timing.split(' · ').map((part) => {
    if (part.endsWith(' total')) return { label: 'Total time', value: part.slice(0, -6) }
    if (part === 'incomplete') return { label: 'Timing record', value: 'Incomplete' }
    const space = part.indexOf(' ')
    const label = TIMING_LABELS[part.slice(0, space)]
    return label ? { label, value: part.slice(space + 1) } : { label: 'Recorded timing', value: part }
  })
}

function Metrics({ details }: { details: Detail[] }) {
  return (
    <dl className="sky-reply-metrics">
      {details.map((detail, index) => (
        <Fragment key={index}>
          <div>
            <dt>{detail.label}</dt>
            <dd>{detail.value}</dd>
          </div>
        </Fragment>
      ))}
    </dl>
  )
}

export function ReplyDetails({ usage, model, timing }: { usage?: TokenUsage; model?: string; timing?: string }) {
  if (!usage && !timing) return null
  const tokens = usage
    ? [
        { label: 'Input', value: formatTokens(totalInput(usage)) },
        { label: 'From cache', value: formatTokens(usage.cacheRead) },
        { label: 'Output', value: formatTokens(usage.output) },
        ...(usage.cacheWrite > 0 ? [{ label: 'Written to cache', value: formatTokens(usage.cacheWrite) }] : []),
      ]
    : []
  return (
    <details className="sky-reply-details">
      <summary>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        Reply details
      </summary>
      <div className="sky-reply-details-body">
        {model && (
          <dl className="sky-reply-model">
            <dt>Model</dt>
            <dd>{model}</dd>
          </dl>
        )}
        {usage && (
          <section aria-label="Token usage">
            <h3>Tokens</h3>
            <Metrics details={tokens} />
            <p className="sky-reply-details-note">Cached tokens are included in input.</p>
          </section>
        )}
        {timing && (
          <section aria-label="Reply timing">
            <h3>Time</h3>
            <Metrics details={timingDetails(timing)} />
          </section>
        )}
      </div>
    </details>
  )
}
