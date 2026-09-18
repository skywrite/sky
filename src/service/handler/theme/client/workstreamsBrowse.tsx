import { Button, Modal, TextInput } from '@mantine/core'
import { useState } from 'react'
import type { WorkstreamRecord } from '#lib/workstreams/types.ts'
import { openWorkstreamMenu, WorkstreamMenuButton, type WorkstreamMenuTarget } from './workstreamsMenu.tsx'

/** Keyboard and screen-reader navigation over the same filtered work as the canvas. */
export function WorkstreamsBrowse({
  items,
  navigate,
  onMenu,
  busy,
}: {
  items: WorkstreamRecord[]
  navigate: (path: string) => void
  onMenu: (target: WorkstreamMenuTarget) => void
  busy: boolean
}) {
  const [opened, setOpened] = useState(false)
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const matches = items.filter((item) =>
    `${item.title} ${item.outcome} ${item.activities.map((activity) => activity.title).join(' ')}`
      .toLowerCase()
      .includes(needle),
  )
  const open = (id: string, activityId?: string) => {
    setOpened(false)
    navigate(`/workstreams/${encodeURIComponent(id)}${activityId ? `?activity=${encodeURIComponent(activityId)}` : ''}`)
  }
  const menu = (target: WorkstreamMenuTarget) => {
    setOpened(false)
    onMenu(target)
  }
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpened(true)}>
        Browse work
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Browse workstreams" size="lg" returnFocus={false}>
        <TextInput
          label="Find work or an activity"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          autoFocus
        />
        {!matches.length && <p>No work matches this view.</p>}
        <ul aria-label="Workstreams and activities" style={{ listStyle: 'none', padding: 0 }}>
          {matches.map((item) => (
            <li
              key={item.id}
              style={{ padding: '16px 0', borderBottom: '1px solid var(--mantine-color-gray-2)' }}
              onContextMenu={(event) => {
                if (!busy) openWorkstreamMenu(event, item.id, item.title, menu)
              }}
            >
              <div className="sky-workstream-section-head">
                <Button variant="secondary" onClick={() => open(item.id)}>
                  {item.title}
                </Button>
                <WorkstreamMenuButton workstreamId={item.id} title={item.title} disabled={busy} onMenu={menu} />
              </div>
              {item.outcome && <p style={{ margin: '4px 12px 12px' }}>{item.outcome}</p>}
              <ul style={{ listStyle: 'none', paddingLeft: 12 }}>
                {item.activities
                  .filter((activity) => activity.state !== 'canceled')
                  .map((activity) => (
                    <li key={activity.id}>
                      <Button variant="secondary" size="sm" onClick={() => open(item.id, activity.id)}>
                        {activity.title}
                      </Button>
                      <span style={{ fontSize: 12, color: 'var(--mantine-color-gray-6)' }}>
                        {activity.kind === 'decision' ? 'Decision' : 'Action'} · {activity.state}
                      </span>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  )
}
