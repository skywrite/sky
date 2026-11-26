import { type MouseEvent, type ReactNode, useEffect, useEffectEvent, useRef } from 'react'
import { ExtensionNavLinks } from '../extensions/extensions.tsx'
import type { SidebarExperiments } from '../settings/settings.tsx'
import { SidebarIcon } from './sidebarIcon.tsx'
import { SIDEBAR_UTILITIES, type SidebarUtility } from './sidebarUtilities.tsx'
import './MorePanel.css'

export type MoreDestination = 'outbox' | 'workstreams' | SidebarUtility | 'people' | 'places' | 'recurring'

const RECORDS = [
  { id: 'people', label: 'People & Orgs', href: '/people' },
  { id: 'places', label: 'Places', href: '/places' },
  { id: 'recurring', label: 'Recurring', href: '/recurring' },
] as const

function ToolIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/**
 * Everything the bar leaves out, opened from More: the tools, the records kept beside
 * settings, and the extensions' pages. It floats over the page above the bar; tapping
 * outside, More again, or Escape closes it, and so does going anywhere.
 */
export function MorePanel({
  open,
  active,
  extensionPage,
  experiments,
  brand,
  notices,
  navigate,
  onClose,
}: {
  open: boolean
  active: MoreDestination | null
  extensionPage: string | null
  experiments: SidebarExperiments
  /** The wordmark and the clock, as the sidebar shows them */
  brand: ReactNode
  /** A restart waiting, or an import waiting on the person */
  notices: ReactNode
  navigate: (to: string) => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useEffectEvent(onClose)
  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close()
      document.querySelector<HTMLElement>('[aria-controls="sky-more-panel"]')?.focus()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open])
  if (!open) return null

  const row = (id: MoreDestination, href: string, label: string, icon?: ReactNode) => (
    <a
      key={id}
      href={href}
      className="sky-list-row"
      data-active={active === id}
      aria-current={active === id ? 'page' : undefined}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(href)
      }}
    >
      {icon}
      <span className="sky-list-label">{label}</span>
    </a>
  )

  return (
    <>
      <div className="sky-more-panel-scrim" onClick={onClose} />
      <div ref={panel} id="sky-more-panel" className="sky-more-panel" role="dialog" aria-label="More" tabIndex={-1}>
        <div className="sky-side-top sky-more-panel-brand">{brand}</div>
        {notices}
        {(experiments.outbox || experiments.workstreams) && (
          <div className="sky-list" data-icons>
            {experiments.outbox && row('outbox', '/outbox', 'Outbox', <SidebarIcon name="outbox" />)}
            {experiments.workstreams &&
              row('workstreams', '/workstreams', 'Workstreams', <SidebarIcon name="workstreams" />)}
          </div>
        )}
        <div className="sky-list" data-icons role="group" aria-label="Tools">
          {SIDEBAR_UTILITIES.map((tool) =>
            row(tool.id, `/${tool.id}`, tool.menuLabel, <ToolIcon>{tool.icon}</ToolIcon>),
          )}
        </div>
        <div className="sky-list">
          {RECORDS.map((record) => row(record.id, record.href, record.label))}
          <ExtensionNavLinks active={extensionPage} navigate={navigate} className="sky-list-row" />
        </div>
      </div>
    </>
  )
}
