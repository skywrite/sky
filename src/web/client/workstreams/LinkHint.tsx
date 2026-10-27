export function LinkHint({ overTarget }: { overTarget: boolean }) {
  return (
    <div className="sky-workstreams-link-hint" role="status">
      {overTarget ? 'Release to choose how these workstreams relate' : 'Drop on another workstream · Esc to cancel'}
    </div>
  )
}
