import { BANDS, type Band } from '#lib/decisionWizard/plan.ts'

/**
 * One scale for the odds. The person picks their range on it first; Sky's
 * range then appears under it on the same five steps, so how far apart the two
 * are is seen, not read.
 */
export function OddsScale({
  label,
  mine,
  sky,
  onPick,
}: {
  /** The question the odds answer, for a screen reader */
  label: string
  mine: Band | undefined
  sky: Band
  onPick: (band: Band) => void
}) {
  return (
    <div className="sky-wizard-scale">
      <span className="sky-wizard-scale-who">You</span>
      <div className="sky-wizard-scale-bands" role="radiogroup" aria-label={label}>
        {BANDS.map((band, at) => (
          <button
            key={band}
            type="button"
            role="radio"
            aria-checked={mine === at}
            className="sky-wizard-band"
            onClick={() => onPick(at as Band)}
          >
            {band}
          </button>
        ))}
      </div>
      {mine !== undefined && (
        <>
          <span className="sky-wizard-scale-who">Sky</span>
          <div className="sky-wizard-scale-bands" aria-hidden="true">
            {BANDS.map((band, at) => (
              <span key={band} className="sky-wizard-band-sky" data-on={at === sky || undefined}>
                {at === sky ? band : ''}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
