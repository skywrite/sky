import { Button, Modal, NumberInput, Select, Textarea } from '@mantine/core'
import { useState } from 'react'
import type { SkySettings, WorkstreamRecord } from '#lib/workstreams/types.ts'

export function SkyEditor({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: WorkstreamRecord
  busy: boolean
  onClose: () => void
  onSave: (settings: SkySettings) => void
}) {
  const [draft, setDraft] = useState(item.sky)
  return (
    <Modal opened onClose={onClose} title="Sky’s responsibility" size="lg">
      <div className="sky-workstream-edit">
        <p>Give Sky an ongoing responsibility to help develop the understanding and move this work forward.</p>
        <Select
          label="How should Sky participate?"
          value={draft.mode}
          data={[
            { value: 'off', label: 'I’ll lead · ask for help when useful' },
            { value: 'assist', label: 'Assist · review, propose, and prepare useful work' },
            { value: 'drive', label: 'Carry it · advance authorized work and surface decisions' },
          ]}
          onChange={(mode) => setDraft({ ...draft, mode: mode as SkySettings['mode'] })}
        />
        <Textarea
          label="Responsibility and boundaries"
          autosize
          minRows={4}
          value={draft.instruction}
          onChange={(event) => setDraft({ ...draft, instruction: event.currentTarget.value })}
        />
        <div className="sky-workstream-form-grid">
          <NumberInput
            label="Review every (hours)"
            min={0.25}
            max={720}
            value={draft.reviewEveryHours}
            onChange={(value) => setDraft({ ...draft, reviewEveryHours: Number(value) || 24 })}
          />
          <NumberInput
            label="Maximum reviews per day"
            min={1}
            max={96}
            value={draft.maxRunsPerDay}
            onChange={(value) => setDraft({ ...draft, maxRunsPerDay: Number(value) || 8 })}
          />
        </div>
        <NumberInput
          label="Total review cap, if useful"
          description="Leave empty for ongoing responsibility without a lifetime cap. Daily limits still apply."
          min={1}
          max={10000}
          value={draft.maxRunsTotal ?? ''}
          onChange={(value) => setDraft({ ...draft, maxRunsTotal: value === '' ? undefined : Number(value) })}
        />
        <p className="sky-workstream-hint">
          Sky can develop the work, prepare deliverables, evaluate decisions, and keep stakeholders informed. Decisions,
          completion criteria, and recurring report delivery follow the specific responsibilities you set for them.
        </p>
        <Button variant="primary" disabled={busy} onClick={() => onSave(draft)}>
          {draft.mode === 'off' ? 'Save responsibility' : 'Enable ongoing help'}
        </Button>
      </div>
    </Modal>
  )
}
