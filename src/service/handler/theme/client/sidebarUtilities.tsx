import { ActionIcon, Tooltip } from '@mantine/core'
import type { MouseEvent } from 'react'

const utilities = [
  {
    id: 'automations',
    label: 'Automations',
    icon: <path d="m13.3 2-9 11h6.8L10.7 22l9-12h-6.8L13.3 2Z" />,
  },
  {
    id: 'explorer',
    label: 'Explorer',
    icon: <path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <>
        <path d="m9.5 3-.5 2a7.5 7.5 0 0 0-1.4.8l-2-.5-2.5 4.3 1.5 1.4a7.5 7.5 0 0 0 0 1.6L3.1 14l2.5 4.3 2-.5a7.5 7.5 0 0 0 1.4.8l.5 2h5l.5-2a7.5 7.5 0 0 0 1.4-.8l2 .5 2.5-4.3-1.5-1.4a7.5 7.5 0 0 0 0-1.6l1.5-1.4-2.5-4.3-2 .5A7.5 7.5 0 0 0 15 5l-.5-2h-5Z" />
        <circle cx="12" cy="11.8" r="3" />
      </>
    ),
  },
] as const

export function SidebarUtilities({
  active,
  navigate,
}: {
  active: (typeof utilities)[number]['id'] | null
  navigate: (to: string) => void
}) {
  return (
    <div className="sky-side-utilities" role="group" aria-label="Tools">
      {utilities.map(({ id, label, icon }) => (
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
            variant={active === id ? 'primary' : 'secondary'}
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
