import { effectiveEffort, EFFORTS } from '#universal/ai/effort.ts'
import type { ProfileRow } from '../settings.tsx'
import { effortText } from './presets.ts'

export function EffortSummary({ profile, full = false }: { profile: ProfileRow; full?: boolean }) {
  const level = effectiveEffort(profile)
  return (
    <span className="sky-model-effort">
      {level && (
        <span className="sky-model-meter" aria-hidden="true">
          {EFFORTS.map((stop, i) => (
            <i key={stop} data-on={i <= EFFORTS.indexOf(level)} style={{ height: 5 + i * 2 }} />
          ))}
        </span>
      )}
      {effortText(profile, full)}
    </span>
  )
}
