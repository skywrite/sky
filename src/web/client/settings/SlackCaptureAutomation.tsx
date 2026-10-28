import { Button, Select } from '@mantine/core'
import { Block, OnOff, Row } from './settingsBlocks.tsx'
import { useSlackCaptureAutomation } from './useSlackCaptureAutomation.ts'

const INTERVALS = [1, 5, 15, 30, 60]

export function SlackCaptureAutomation({ navigate }: { navigate: (to: string) => void }) {
  const { settings, error, busy, reload, change } = useSlackCaptureAutomation()
  const options = INTERVALS.map((minutes) => ({
    value: String(minutes),
    label: `Every ${minutes} minute${minutes === 1 ? '' : 's'}`,
  }))
  const value = settings?.minutes === null ? 'custom' : String(settings?.minutes ?? 5)
  if (settings && !options.some((option) => option.value === value))
    options.push({ value, label: settings.minutes === null ? settings.schedule : `Every ${settings.minutes} minutes` })

  return (
    <Block
      head="Saved and To-dos"
      note="Automatically capture messages you mark in Slack. To-dos go into today's Reminders; saved messages are kept for context. Captured items are marked complete in Slack."
    >
      {!settings && !error && <p className="sky-set-sub">Loading automation…</p>}
      {settings && (
        <>
          <Row
            label="Automatic capture"
            sub={settings.enabled ? 'Runs while the Sky service is running.' : 'Automatic capture is off.'}
          >
            <OnOff
              label="Automatically capture saved Slack messages and to-dos"
              value={settings.enabled}
              disabled={busy}
              onChange={(enabled) => void change({ enabled })}
            />
          </Row>
          <Row label="Check for new items" last>
            <Select
              aria-label="Slack capture interval"
              size="sm"
              w={190}
              allowDeselect={false}
              disabled={busy}
              data={options}
              value={value}
              onChange={(next) => {
                if (next && next !== 'custom') void change({ minutes: Number(next) })
              }}
            />
          </Row>
        </>
      )}
      {error && (
        <p className="sky-set-warn" role="alert">
          {error}
        </p>
      )}
      <div className="sky-set-actions">
        {(settings?.name || error) && (
          <Button
            size="sm"
            onClick={() =>
              navigate(settings?.name ? `/automations/${encodeURIComponent(settings.name)}` : '/automations')
            }
          >
            {settings?.name ? 'View automation' : 'Open Automations'}
          </Button>
        )}
        {error && (
          <Button size="sm" disabled={busy} onClick={() => void reload()}>
            Try again
          </Button>
        )}
      </div>
    </Block>
  )
}
