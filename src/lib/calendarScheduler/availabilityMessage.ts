import type { AvailabilityDay, TimeRange } from './findTime.ts'

export const defaultAvailabilityTemplate =
  'Here’s when I’m free (all times {{timezone}}).\n\n{{days}}\n\nWould any of those work for you?'

export interface DayLineStyle {
  dayLine: string
  timeSeparator: string
}

export interface AvailabilityTemplate extends DayLineStyle {
  template: string
}

export const defaultDayLineStyle: DayLineStyle = { dayLine: '• {{day}}: {{times}}', timeSeparator: ' or ' }

export function templateError(template: string): string {
  if (template.length > 4000) return 'Keep the availability template under 4,000 characters.'
  if (template.split('{{days}}').length !== 2 || !/^\s*{{days}}\s*$/m.test(template))
    return 'Put {{days}} on a line of its own, exactly once, for the selected days.'
  if (/{{|}}/.test(template.replace('{{days}}', '').replace('{{timezone}}', '')))
    return 'Use {{days}} once and an optional {{timezone}} in the email template.'
  return ''
}

function dayLineError(line: string): string {
  if (line.length > 500 || /[\r\n]/.test(line)) return 'Keep the day format on one line of up to 500 characters.'
  if (line.split('{{times}}').length !== 2) return 'Include {{times}} once for the selected openings.'
  if (!/{{(?:day|weekday|date)}}/.test(line)) return 'Include {{day}}, {{weekday}}, or {{date}} to identify the day.'
  if (/{{|}}/.test(line.replace(/{{(?:day|weekday|date|times|timezone)}}/g, '')))
    return 'Use {{day}}, {{weekday}}, {{date}}, {{times}}, or {{timezone}} in the day line.'
  return ''
}

export function formatErrors({ template, dayLine, timeSeparator }: AvailabilityTemplate) {
  return {
    template:
      templateError(template) ||
      (!template.includes('{{timezone}}') && !dayLine.includes('{{timezone}}')
        ? 'Include {{timezone}} in the email template or day line.'
        : ''),
    dayLine: dayLineError(dayLine),
    timeSeparator:
      /[\r\n]/.test(timeSeparator) || timeSeparator.length > 80
        ? 'Use up to 80 characters between openings on the same line.'
        : '',
  }
}

export const rangeKey = ({ start, end }: TimeRange): string => `${start}/${end}`

const commonStartMinutes: Record<string, string> = {
  '0': 'on the hour',
  '30': 'at half past the hour',
  '0,30': 'on the hour or half hour',
  '0,15,30,45': 'on a quarter hour',
}

export function startMinutePhrase(minutes?: readonly number[]): string {
  if (!minutes?.length) return ''
  const phrase = commonStartMinutes[minutes.join(',')]
  if (phrase) return phrase
  const marks = minutes.map((minute) => ':' + String(minute).padStart(2, '0'))
  return `at ${new Intl.ListFormat('en-US', { type: 'disjunction' }).format(marks)} each hour`
}

export function selectedTimes(day: AvailabilityDay, selection: ReadonlySet<string> | null): string[] {
  // An opening that spans midnight is selectable in both columns and belongs to its starting day's line.
  return day.entries
    .filter(
      (entry) => entry.kind === 'free' && !entry.continued && (selection === null || selection.has(rangeKey(entry))),
    )
    .map((entry) => entry.label)
}

export function formatDayLine(
  style: DayLineStyle,
  day: Pick<AvailabilityDay, 'label' | 'weekday' | 'monthDay'>,
  times: string[],
  timezone: string,
): string {
  const values = {
    day: day.label,
    weekday: day.weekday,
    date: day.monthDay,
    times: times.join(style.timeSeparator),
    timezone,
  }
  return style.dayLine.replace(/{{(day|weekday|date|times|timezone)}}/g, (_, key: keyof typeof values) => values[key])
}

export function availabilityMessage(
  template: string,
  days: AvailabilityDay[],
  selection: ReadonlySet<string> | null,
  timezone: string,
  style: DayLineStyle = defaultDayLineStyle,
  startMinutes?: readonly number[],
): string {
  const lines: string[] = []
  for (const day of days) {
    const times = selectedTimes(day, selection)
    if (times.length) lines.push(formatDayLine(style, day, times, timezone))
  }
  if (!lines.length) return ''
  const rule = startMinutePhrase(startMinutes)
  const availability = rule ? `${lines.join('\n')}\n\nI can start ${rule}.` : lines.join('\n')
  return template.replace(/^[^\S\r\n]*{{days}}[^\S\r\n]*$|{{timezone}}/gm, (placeholder) =>
    placeholder === '{{timezone}}' ? timezone : availability,
  )
}
