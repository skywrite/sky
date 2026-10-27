import type { WorkstreamSource } from '#lib/workstreams/types.ts'
import { fileHref } from '../explorer/explorer.tsx'

const sourceName = (sources: WorkstreamSource[], id: string) => {
  const source = sources.find((value) => value.id === id)
  return source?.label || source?.path || 'Unavailable source'
}

export function Evidence({
  sources,
  evidence,
}: {
  sources: WorkstreamSource[]
  evidence: { sourceId: string; quote: string }[]
}) {
  return (
    <div className="sky-workstream-evidence">
      {evidence.map((entry, index) => {
        const source = sources.find((value) => value.id === entry.sourceId)
        return (
          <blockquote key={`${entry.sourceId}-${index}`}>
            <p>{entry.quote}</p>
            {source ? (
              <a href={fileHref(source.path)}>{sourceName(sources, entry.sourceId)} ↗</a>
            ) : (
              <span>Source unavailable</span>
            )}
          </blockquote>
        )
      })}
    </div>
  )
}
