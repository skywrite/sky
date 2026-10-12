/**
 * The shell of a connection's own page under Settings › Connections: the way
 * back, the breadcrumb, the name and one line on what the connection gives,
 * then the page's blocks. Beeper has one; the others follow the same shape.
 */

import { Button } from '@mantine/core'
import type { ReactNode } from 'react'
import { settingsHref } from './settingsRoutes.ts'

export function ConnectionPage({
  name,
  gives,
  navigate,
  children,
}: {
  /** The connection's name, as the heading */
  name: string
  /** One or two sentences on what the connection gives Sky */
  gives: ReactNode
  navigate: (to: string) => void
  children: ReactNode
}) {
  return (
    <div className="sky-main">
      <header className="sky-head">
        <Button size="sm" onClick={() => navigate(settingsHref('connections'))} style={{ marginLeft: -10 }}>
          ‹ Connections
        </Button>
        <span className="sky-set-breadcrumb">
          Settings<span aria-hidden="true">›</span>Connections
        </span>
      </header>
      <div className="sky-scroll">
        <div className="sky-col sky-set">
          <div className="sky-set-heading">
            <h1>{name}</h1>
            <p>{gives}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
