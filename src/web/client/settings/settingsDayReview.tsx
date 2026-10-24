import { Button, NumberInput } from '@mantine/core'
import { useState } from 'react'
import { saveSetting } from './settings.tsx'
import { Block, Row } from './settingsBlocks.tsx'

export function DayReviewSettings({ hours }: { hours: number }) {
  const [value, setValue] = useState<number | string>(hours)
  const [saved, setSaved] = useState(hours)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  return (
    <Block head="Day review">
      <Row
        label="Review after time away"
        sub="When you return after this many idle hours and the calendar has moved past your notebook day, Sky opens its review. Start and End stay manual. Set 0 to turn the popup off."
        last
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <NumberInput
            label="Idle hours"
            value={value}
            onChange={setValue}
            min={0}
            max={24}
            step={0.5}
            decimalScale={2}
            style={{ width: 125 }}
          />
          <Button
            aria-label="Save day review settings"
            variant="secondary"
            loading={busy}
            disabled={value === '' || Number(value) === saved}
            onClick={async () => {
              setBusy(true)
              const error = await saveSetting('dayReview.idleHours', String(value))
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
      <p className="sky-set-help">
        Uses keyboard and mouse activity on the Mac running Sky. You can always reopen a review from its day page.
      </p>
    </Block>
  )
}
