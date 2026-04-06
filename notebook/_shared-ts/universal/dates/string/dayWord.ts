// TypeScript tip - selecting a property from an interface 'weekday'

export default function dayWord(day: Date, format: Intl.DateTimeFormatOptions['weekday']): string {
  return day.toLocaleDateString('en-US', { weekday: format })
}
