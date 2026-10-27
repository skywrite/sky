import type { CSSProperties } from 'react'
import type { WorkstreamColor } from '#lib/workstreams/colors.ts'

export function workstreamColorStyle(color: WorkstreamColor = 'blue'): CSSProperties {
  return {
    '--sky-workstream-card-fill': `var(--sky-workstream-${color}-fill)`,
    '--sky-workstream-card-border': `var(--sky-workstream-${color}-border)`,
    '--sky-workstream-card-accent': `var(--sky-workstream-${color}-accent)`,
    '--sky-workstream-card-ink': `var(--sky-workstream-${color}-ink)`,
  } as CSSProperties
}
