import './ScoreDots.css'

/** What a reply earns, as five dots: one filled per 20 points, in a lighter shade as the score drops. */
export function ScoreDots({ points }: { points: number }) {
  // A list read from an older service carries no points yet: show it as worth nothing rather than as NaN.
  const worth = Number.isFinite(points) ? points : 0
  const filled = Math.max(0, Math.min(5, Math.round(worth / 20)))
  return (
    <span className="sky-score-dots" data-level={filled} role="img" aria-label={`Worth ${worth} points`}>
      {[1, 2, 3, 4, 5].map((dot) => (
        <i key={dot} data-on={dot <= filled ? '' : undefined} />
      ))}
    </span>
  )
}
