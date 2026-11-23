import { NativeSelect, NumberInput, Popover, Select, TextInput, UnstyledButton } from '@mantine/core'
import { useMemo } from 'react'
import { startMinutePhrase } from '#lib/calendarScheduler/availabilityMessage.ts'
import type { AvailabilitySearch } from '#lib/calendarScheduler/findTime.ts'
import { zoneChoices, zoneLabel } from './zones.ts'

function clock(time: string): string {
  const [hour, minute] = time.split(':').map(Number)
  return `${hour! % 12 || 12}${minute ? ':' + String(minute).padStart(2, '0') : ''} ${hour! % 24 < 12 ? 'am' : 'pm'}`
}

const startPresets = [[], [0], [0, 30], [30], [0, 15, 30, 45]]

function startChoices(selected: number[] = []) {
  const presets = startPresets.some((marks) => marks.join(',') === selected.join(','))
    ? startPresets
    : [...startPresets, selected]
  return presets.map((marks) => {
    const phrase = startMinutePhrase(marks)
    return { value: marks.join(','), label: phrase ? phrase[0]!.toUpperCase() + phrase.slice(1) : 'Any minute' }
  })
}

export function SearchControls({
  search,
  change,
}: {
  search: AvailabilitySearch
  change: (updates: Partial<AvailabilitySearch>) => void
}) {
  const zones = useMemo(
    () => zoneChoices([search.timezone, search.displayTimezone]),
    [search.timezone, search.displayTimezone],
  )
  return (
    <div className="sky-find-controls">
      <Popover position="bottom-start" shadow="sm" width={320} withinPortal>
        <Popover.Target>
          <UnstyledButton className="sky-find-window" aria-label="Adjust search hours and time zone">
            <span>
              {clock(search.startTime)}–{clock(search.endTime)} {zoneLabel(search.timezone)}
            </span>
            <span aria-hidden="true">⌄</span>
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown className="sky-find-window-editor">
          <div>
            <TextInput
              label="From"
              type="time"
              value={search.startTime}
              onChange={(event) => {
                if (event.currentTarget.value) change({ startTime: event.currentTarget.value })
              }}
            />
            <TextInput
              label="Until"
              type="time"
              value={search.endTime === '24:00' ? '00:00' : search.endTime}
              onChange={(event) => {
                const time = event.currentTarget.value
                if (time) change({ endTime: time === '00:00' ? '24:00' : time })
              }}
            />
          </div>
          <Select
            label="Search time zone"
            searchable
            allowDeselect={false}
            data={zones}
            value={search.timezone}
            comboboxProps={{ withinPortal: false }}
            onChange={(value) => {
              if (value) change({ timezone: value })
            }}
          />
          <NumberInput
            label="Minimum opening (minutes)"
            min={1}
            max={1440}
            allowDecimal={false}
            value={search.minimumMinutes}
            onChange={(value) => {
              if (typeof value === 'number') change({ minimumMinutes: value })
            }}
          />
          <NativeSelect
            label={`Meeting starts (${zoneLabel(search.displayTimezone)})`}
            data={startChoices(search.startMinutes)}
            value={search.startMinutes?.join(',') ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value
              change({ startMinutes: value ? value.split(',').map(Number) : [] })
            }}
          />
        </Popover.Dropdown>
      </Popover>
      <NumberInput
        aria-label="Buffer between meetings in minutes"
        suffix=" min buffer"
        min={0}
        max={1440}
        allowDecimal={false}
        value={search.bufferMinutes}
        onChange={(value) => {
          if (typeof value === 'number') change({ bufferMinutes: value })
        }}
      />
      <Select
        aria-label="Display time zone"
        leftSection="Show in"
        leftSectionWidth={62}
        className="sky-find-display-zone"
        searchable
        allowDeselect={false}
        data={zones}
        value={search.displayTimezone}
        onChange={(value) => {
          if (value) change({ displayTimezone: value })
        }}
      />
    </div>
  )
}
