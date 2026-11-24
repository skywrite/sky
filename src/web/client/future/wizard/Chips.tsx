/** A short row of choices where each is a word or two: odds, dates, yes or no. */
export function Chips({
  labels,
  picked,
  onPick,
  label,
}: {
  labels: string[]
  /** The places picked, from 0 */
  picked: number[]
  onPick: (at: number) => void
  label: string
}) {
  return (
    <div className="sky-wizard-chips" role="radiogroup" aria-label={label}>
      {labels.map((text, at) => (
        <button
          key={text}
          type="button"
          className="sky-wizard-chip"
          role="radio"
          aria-checked={picked.includes(at)}
          onClick={() => onPick(at)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
