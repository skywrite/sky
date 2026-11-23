import { Button, Popover } from '@mantine/core'
import type { AvailabilityCalendar } from '#lib/calendarScheduler/findTime.ts'

export function CalendarPicker({
  calendars,
  disabled,
  toggle,
}: {
  calendars: AvailabilityCalendar[]
  disabled: string[]
  toggle: (id: string) => void
}) {
  const count = calendars.filter((calendar) => !disabled.includes(calendar.id)).length
  return (
    <Popover position="bottom-end" width="min(340px, calc(100vw - 32px))" shadow="sm" trapFocus returnFocus>
      <Popover.Target>
        <Button variant="default" size="compact-sm" aria-label={`Calendars, ${count} of ${calendars.length} on`}>
          Calendars · {count}/{calendars.length}
        </Button>
      </Popover.Target>
      <Popover.Dropdown className="sky-find-calendar-picker" aria-label="Calendars for availability">
        <strong>Calendars for availability</strong>
        <div className="sky-find-calendar-list">
          {calendars.map(({ id, label }) => {
            const on = !disabled.includes(id)
            return (
              <button key={id} type="button" aria-label={label} aria-pressed={on} onClick={() => toggle(id)}>
                <span>{label}</span>
                <small>{on ? 'On' : 'Off'}</small>
              </button>
            )
          })}
        </div>
      </Popover.Dropdown>
    </Popover>
  )
}
