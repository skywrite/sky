import { RESPONSE_SCORE_PATH } from './routes.ts'
import './ResponseScoreLink.css'

/**
 * A card head's link to the response score, in the same style as "View all streaks →".
 * Phones show "Score" so the head stays on one line.
 */
export function ResponseScoreLink({ points, navigate }: { points: number; navigate: (path: string) => void }) {
  const total = points.toLocaleString('en-US')
  return (
    <a
      className="sky-score-link"
      href={RESPONSE_SCORE_PATH}
      aria-label={`Response score: ${total} points today`}
      onClick={(event) => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(RESPONSE_SCORE_PATH)
      }}
    >
      <span className="sky-score-link-full">Today's score</span>
      <span className="sky-score-link-short">Score</span>
      <b>{total}</b>
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 12h15m-5-5 5 5-5 5" />
      </svg>
    </a>
  )
}
