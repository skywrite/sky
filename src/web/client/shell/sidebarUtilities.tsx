import { ActionIcon, Tooltip } from '@mantine/core'
import type { MouseEvent } from 'react'

/** The tools every page reaches: the sidebar's footer, and More on a phone, where Explorer reads as Files. */
export const SIDEBAR_UTILITIES = [
  {
    id: 'whiteboard',
    label: 'Whiteboard',
    menuLabel: 'Whiteboard',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M2 17h20" />
        <path d="M13 17v-2.5h4V17" />
        <path d="M8 21l2-4M16 21l-2-4" />
      </>
    ),
  },
  {
    id: 'automations',
    label: 'Automations',
    menuLabel: 'Automations',
    icon: <path d="m13.3 2-9 11h6.8L10.7 22l9-12h-6.8L13.3 2Z" />,
  },
  {
    id: 'explorer',
    label: 'Explorer',
    menuLabel: 'Files',
    icon: <path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  },
  {
    id: 'settings',
    label: 'Settings',
    menuLabel: 'Settings',
    icon: (
      <>
        <path d="m9.5 3-.5 2a7.5 7.5 0 0 0-1.4.8l-2-.5-2.5 4.3 1.5 1.4a7.5 7.5 0 0 0 0 1.6L3.1 14l2.5 4.3 2-.5a7.5 7.5 0 0 0 1.4.8l.5 2h5l.5-2a7.5 7.5 0 0 0 1.4-.8l2 .5 2.5-4.3-1.5-1.4a7.5 7.5 0 0 0 0-1.6l1.5-1.4-2.5-4.3-2 .5A7.5 7.5 0 0 0 15 5l-.5-2h-5Z" />
        <circle cx="12" cy="11.8" r="3" />
      </>
    ),
  },
] as const

export type SidebarUtility = (typeof SIDEBAR_UTILITIES)[number]['id']

export function SidebarUtilities({
  active,
  navigate,
}: {
  active: SidebarUtility | null
  navigate: (to: string) => void
}) {
  return (
    <div className="sky-side-utilities" role="group" aria-label="Tools">
      {SIDEBAR_UTILITIES.map(({ id, label, icon }) => (
        <Tooltip
          key={id}
          label={label}
          position="top"
          withArrow
          openDelay={200}
          events={{ hover: true, focus: true, touch: false }}
        >
          <ActionIcon
            component="a"
            href={`/${id}`}
            className="sky-side-utility"
            variant={active === id ? 'light' : 'secondary'}
            radius="md"
            aria-label={label}
            aria-current={active === id ? 'page' : undefined}
            data-active={active === id}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return
              event.preventDefault()
              navigate(`/${id}`)
            }}
          >
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
            >
              {icon}
            </svg>
          </ActionIcon>
        </Tooltip>
      ))}
    </div>
  )
}
