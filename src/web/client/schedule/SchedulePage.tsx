import { Button, Tabs } from '@mantine/core'
import { useState } from 'react'
import { MeetingComposer } from '../meetings/meeting.tsx'
import { FindTime } from './FindTime.tsx'
import './SchedulePage.css'

export function SchedulePage({ find, navigate }: { find: boolean; navigate: (path: string) => void }) {
  const [query, setQuery] = useState('')
  return (
    <main className="sky-main sky-schedule-page">
      <header className="sky-schedule-heading">
        <Button size="compact-sm" onClick={() => navigate('/clock')}>
          ‹ Clock
        </Button>
        <h1>Schedule meeting</h1>
      </header>
      <Tabs
        className="sky-schedule-tabs"
        value={find ? 'find' : 'book'}
        onChange={(tab) => navigate(tab === 'find' ? '/schedule?tab=find' : '/schedule')}
      >
        <Tabs.List aria-label="Scheduling">
          <Tabs.Tab value="book">Book a meeting</Tabs.Tab>
          <Tabs.Tab value="find">Find a time</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="book">
          <MeetingComposer opened={!find} query={query} setQuery={setQuery} onClose={() => navigate('/clock')} />
        </Tabs.Panel>
        <Tabs.Panel value="find">
          <FindTime active={find} query={query} setQuery={setQuery} />
        </Tabs.Panel>
      </Tabs>
    </main>
  )
}
