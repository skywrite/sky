import { Button, NumberInput, SegmentedControl } from '@mantine/core'
import { useEffect, useState } from 'react'
import { saveSetting, type SettingsData } from './settings.tsx'
import { Block, Row } from './settingsBlocks.tsx'

type Change = (key: string, value: string, next: (current: SettingsData) => SettingsData) => void

export function RemindersSettings({
  reminders,
  change,
}: {
  reminders: { autoRollover: boolean; expireDays: number }
  change: Change
}) {
  const [value, setValue] = useState<number | string>(reminders.expireDays)
  const [saved, setSaved] = useState(reminders.expireDays)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    setValue(reminders.expireDays)
    setSaved(reminders.expireDays)
  }, [reminders.expireDays])

  return (
    <Block head="Reminders">
      <Row
        label="Roll over automatically"
        sub="When a new day starts, move unfinished reminders from recent unclosed days onto Today without duplicates, and skip the Reminders step in Day Review."
      >
        <SegmentedControl
          aria-label="Roll over reminders automatically"
          value={reminders.autoRollover ? 'on' : 'off'}
          onChange={(next) => {
            const autoRollover = next === 'on'
            change('reminders.autoRollover', String(autoRollover), (current) => ({
              ...current,
              reminders: { ...(current.reminders ?? reminders), autoRollover },
            }))
          }}
          data={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
        />
      </Row>
      <Row
        label="Auto-expire after"
        sub="Drop unfinished reminders untouched for this many days on day start. Recurring reminders expire after 1 day. Set 0 to keep reminders indefinitely."
        last
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <NumberInput
            label="Expire days"
            value={value}
            onChange={setValue}
            min={0}
            max={365}
            step={1}
            allowDecimal={false}
            disabled={!reminders.autoRollover}
            style={{ width: 125 }}
          />
          <Button
            aria-label="Save reminder settings"
            variant="secondary"
            loading={busy}
            disabled={!reminders.autoRollover || value === '' || Number(value) === saved}
            onClick={async () => {
              setBusy(true)
              const error = await saveSetting('reminders.expireDays', String(value))
              setNote(error ?? 'Saved')
              if (!error) setSaved(Number(value))
              setBusy(false)
            }}
          >
            Save
          </Button>
          {note && <span role="status">{note}</span>}
        </div>
      </Row>
    </Block>
  )
}
