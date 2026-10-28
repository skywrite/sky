import type { CaptureResponse } from '#lib/workstreams/captureTypes.ts'
import { fileHref } from '../explorer/explorer.tsx'

export function CaptureContext({ result }: { result: CaptureResponse }) {
  if (!result.understanding && !result.sources.length && !result.contextLimited) return null
  return (
    <details className="sky-workstream-capture-sources">
      <summary>Context Sky found</summary>
      {result.understanding && <p>{result.understanding}</p>}
      {result.sources.length > 0 && (
        <span>
          Based on {result.sources.length} {result.sources.length === 1 ? 'note' : 'notes'}
        </span>
      )}
      {result.sources.map((source) => (
        <a key={source.id} href={fileHref(source.path)} target="_blank" rel="noreferrer">
          {source.label || source.path}
        </a>
      ))}
      {result.contextLimited && <p>Sky used a selection of recent, relevant notes. Some context may be missing.</p>}
    </details>
  )
}
