export function CaptureProgress({
  labels,
  cursor,
  locked,
  onMove,
}: {
  labels: string[]
  cursor: number
  locked: boolean
  onMove: (index: number) => void
}) {
  return (
    <nav className="sky-workstream-capture-progress" aria-label="Workstream setup steps">
      {labels.map((label, index) => (
        <button
          type="button"
          key={index}
          aria-current={cursor === index ? 'step' : undefined}
          onClick={() => onMove(index)}
          disabled={locked}
        >
          {label}
        </button>
      ))}
      {labels.at(-1) !== 'Review' && (
        <button type="button" disabled>
          Review
        </button>
      )}
    </nav>
  )
}
