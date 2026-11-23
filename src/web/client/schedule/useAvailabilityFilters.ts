import { useLocalStorage, useSessionStorage } from '@mantine/hooks'

function readIds(raw?: string): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

const storage = { defaultValue: [] as string[], deserialize: readIds, getInitialValueInEffect: false }
const toggled = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])

export function useAvailabilityFilters() {
  const [disabledCalendars, setDisabled] = useLocalStorage({ ...storage, key: 'sky-find-time-disabled-calendars' })
  const [ignoredEvents, setIgnored] = useSessionStorage({ ...storage, key: 'sky-find-time-ignored-occurrences' })
  return {
    disabledCalendars,
    ignoredEvents,
    toggleCalendar: (id: string) => setDisabled((current) => toggled(current, id)),
    toggleEvent: (id: string) => setIgnored((current) => toggled(current, id)),
  }
}
