import { Drawer } from '@mantine/core'
import type { ComponentProps } from 'react'
import { DayNav } from './DayNav.tsx'
import './DaysSheet.css'

/**
 * On a phone the day's date opens the days the sidebar lists under Today: today itself,
 * tomorrow, the past days and the two weeks. Choosing one goes there and closes the sheet.
 */
export function DaysSheet({
  opened,
  onClose,
  todayYmd,
  todayActive,
  ...nav
}: {
  opened: boolean
  onClose: () => void
  todayYmd: string | null
  todayActive: boolean
} & ComponentProps<typeof DayNav>) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="auto"
      title="Go to a day"
      classNames={{ content: 'sky-days-sheet-content', body: 'sky-days-sheet' }}
    >
      <button
        type="button"
        className="sky-thread"
        data-active={todayActive}
        aria-current={todayActive ? 'page' : undefined}
        onClick={() => nav.navigate('/')}
      >
        <span>Today</span>
        {todayYmd && (
          <time className="sky-meta" dateTime={todayYmd} title={todayYmd}>
            {todayYmd.slice(5)}
          </time>
        )}
      </button>
      <DayNav {...nav} />
    </Drawer>
  )
}
