import { NumberInput, Select, TextInput } from '@mantine/core'
import { canonicalRecurringPattern, RECURRING_DAYS, recurringPatternLabel } from '#universal/dates/recurring/display.ts'
import { patterns } from '#universal/dates/recurring/patterns.ts'

const WEEKDAYS = RECURRING_DAYS.map(([value, label]) => ({ value, label }))
const FREQUENCIES = [
  { value: 'EVERY-DAY', label: 'Every day' },
  { value: 'EVERY-WEEKDAY', label: 'Every weekday' },
  { value: 'EVERY-WEEKEND', label: 'Every weekend' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'alternate-day', label: 'Every other day' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'advanced', label: 'Other schedule' },
]

function family(pattern: string): string {
  if (['EVERY-DAY', 'EVERY-WEEKDAY', 'EVERY-WEEKEND'].includes(pattern)) return pattern
  if (/^EVERY-(MON|TUE|WED|THU|FRI|SAT|SUN)$/.test(pattern)) return 'weekly'
  if (pattern.startsWith('EVERY-2-WEEKS-')) return 'biweekly'
  if (pattern.startsWith('EVERY-OTHER-DAY-')) return 'alternate-day'
  if (/^MONTHLY-(\d+|LAST)$/.test(pattern)) return 'monthly'
  if (/^QUARTERLY-(\d+|LAST)$/.test(pattern)) return 'quarterly'
  return 'advanced'
}

export function RepeatFields({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (pattern: string) => void
  disabled: boolean
}) {
  const pattern = canonicalRecurringPattern(value) ?? value
  const frequency = family(pattern)
  const day = WEEKDAYS.find(({ value }) => pattern.endsWith('-' + value))?.value ?? 'MON'
  const phase = pattern.includes('-B-') || pattern.endsWith('-B') ? 'B' : 'A'
  const prefix = frequency === 'quarterly' ? 'QUARTERLY-' : 'MONTHLY-'
  const monthlyDay = pattern.startsWith(prefix) ? pattern.slice(prefix.length) : '1'
  return (
    <>
      <Select
        label="Repeat"
        data={FREQUENCIES}
        value={frequency}
        disabled={disabled}
        allowDeselect={false}
        onChange={(next) => {
          if (!next) return
          onChange(
            (
              {
                weekly: 'EVERY-MON',
                biweekly: 'EVERY-2-WEEKS-A-MON',
                'alternate-day': 'EVERY-OTHER-DAY-A',
                monthly: 'MONTHLY-1',
                quarterly: 'QUARTERLY-1',
                advanced: 'MONTHLY-FIRST-MON',
              } as Record<string, string>
            )[next] ?? next,
          )
        }}
      />
      {(frequency === 'weekly' || frequency === 'biweekly') && (
        <Select
          label="On"
          data={WEEKDAYS}
          value={day}
          disabled={disabled}
          allowDeselect={false}
          onChange={(next) =>
            next && onChange(frequency === 'weekly' ? 'EVERY-' + next : 'EVERY-2-WEEKS-' + phase + '-' + next)
          }
        />
      )}
      {(frequency === 'biweekly' || frequency === 'alternate-day') && (
        <Select
          label={frequency === 'biweekly' ? 'Alternating week' : 'Alternating day'}
          description="Check the next matching dates below to choose the right phase."
          data={[
            { value: 'A', label: 'A' },
            { value: 'B', label: 'B' },
          ]}
          value={phase}
          disabled={disabled}
          allowDeselect={false}
          onChange={(next) =>
            next && onChange(frequency === 'biweekly' ? 'EVERY-2-WEEKS-' + next + '-' + day : 'EVERY-OTHER-DAY-' + next)
          }
        />
      )}
      {(frequency === 'monthly' || frequency === 'quarterly') && (
        <>
          <Select
            label={frequency === 'monthly' ? 'Day of the month' : 'Day of the quarter'}
            data={[
              { value: 'number', label: 'A numbered day' },
              { value: 'LAST', label: 'The last day' },
            ]}
            value={monthlyDay === 'LAST' ? 'LAST' : 'number'}
            disabled={disabled}
            allowDeselect={false}
            onChange={(next) => next && onChange(prefix + (next === 'LAST' ? 'LAST' : '1'))}
          />
          {monthlyDay !== 'LAST' && (
            <NumberInput
              label="Day number"
              min={1}
              max={frequency === 'monthly' ? 31 : 92}
              value={Number(monthlyDay) || 1}
              disabled={disabled}
              allowDecimal={false}
              onChange={(next) => onChange(prefix + next)}
            />
          )}
        </>
      )}
      {frequency === 'advanced' && (
        <>
          <Select
            label="Choose a schedule"
            placeholder="Search, for example: last Friday"
            searchable
            data={patterns.map(({ pattern }) => ({ value: pattern, label: recurringPatternLabel(pattern) }))}
            value={patterns.some((entry) => entry.pattern === pattern) ? pattern : null}
            disabled={disabled}
            onChange={(next) => next && onChange(next)}
          />
          <TextInput
            label="Pattern"
            description="Existing monthly, quarterly, and offset patterns are supported."
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </>
      )}
    </>
  )
}
