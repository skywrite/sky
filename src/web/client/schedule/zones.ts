const common: Record<string, string> = {
  'America/Los_Angeles': 'Pacific',
  'America/Denver': 'Mountain',
  'America/Chicago': 'Central',
  'America/New_York': 'Eastern',
}
export const zoneLabel = (zone: string): string => common[zone] ?? zone.replaceAll('_', ' ')

export function zoneChoices(zones: string[]) {
  return [...new Set([...Object.keys(common), ...zones, 'UTC', ...Intl.supportedValuesOf('timeZone')])].map((zone) => ({
    value: zone,
    label: zoneLabel(zone),
  }))
}
