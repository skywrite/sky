import { Select } from '@mantine/core'
import type { MouseEvent } from 'react'
import type { DecisionSettings } from './settings.tsx'
import { Block, mono, Row } from './settingsBlocks.tsx'
import { connectionHref } from './settingsRoutes.ts'

export function DecisionsSettings({
  decisions,
  navigate,
}: {
  decisions: DecisionSettings
  navigate: (to: string) => void
}) {
  const typeSafeHref = connectionHref('typesafe')
  const openTypeSafe = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    navigate(typeSafeHref)
  }

  return (
    <>
      <Block>
        <Row label="Decision provider" sub="Used for quick classifications, screening, and priority scoring.">
          {decisions.locked && <span className="sky-set-chip">Locked</span>}
          <Select
            aria-label="Decision provider"
            value={decisions.provider}
            data={[{ value: decisions.provider, label: decisions.providerLabel }]}
            allowDeselect={false}
            disabled={decisions.locked}
            w={220}
          />
        </Row>
        <Row label="Model" sub="Pinned to a specific release so Sky’s probability thresholds stay consistent." last>
          {mono(decisions.model)}
        </Row>
        <p className="sky-set-note">
          Locked to TypeSafe Jev for now. Support for additional decision providers will live here.
        </p>
      </Block>
      <Block head="API access">
        <Row
          label="TypeSafe API key"
          sub={
            decisions.configured ? (
              <>
                Available to the Sky service. Manage it under{' '}
                <a href={typeSafeHref} onClick={openTypeSafe}>
                  Connections › TypeSafe
                </a>
                .
              </>
            ) : (
              <>
                Add your TypeSafe API key under{' '}
                <a href={typeSafeHref} onClick={openTypeSafe}>
                  Connections › TypeSafe
                </a>{' '}
                to enable decision models.
              </>
            )
          }
          last
        >
          <span className={decisions.configured ? 'sky-set-status' : 'sky-set-off'}>
            {decisions.configured ? 'Configured' : 'Not configured'}
          </span>
        </Row>
      </Block>
    </>
  )
}
