import { Button, Modal, Select, Textarea, TextInput } from '@mantine/core'
import { useState } from 'react'
import type { Workstream, WorkstreamRecord } from '#lib/workstreams/types.ts'

export function OverviewEditor({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: WorkstreamRecord
  busy: boolean
  onClose: () => void
  onSave: (patch: Partial<Workstream>) => void
}) {
  const [draft, setDraft] = useState({
    title: item.title,
    outcome: item.outcome,
    understanding: item.understanding,
    unknowns: item.unknowns.join('\n'),
    state: item.state,
    start: item.start ?? '',
    due: item.due ?? '',
  })
  return (
    <Modal opened onClose={onClose} title="Shape this workstream" size="lg">
      <div className="sky-workstream-edit">
        <TextInput
          label="Name"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
        />
        <Textarea
          label="Desired outcome"
          description="What would make this work successful?"
          autosize
          minRows={3}
          value={draft.outcome}
          onChange={(event) => setDraft({ ...draft, outcome: event.currentTarget.value })}
        />
        <Textarea
          label="Current understanding"
          autosize
          minRows={4}
          value={draft.understanding}
          onChange={(event) => setDraft({ ...draft, understanding: event.currentTarget.value })}
        />
        <Textarea
          label="Still to understand"
          description="One question per line."
          autosize
          minRows={2}
          value={draft.unknowns}
          onChange={(event) => setDraft({ ...draft, unknowns: event.currentTarget.value })}
        />
        <div className="sky-workstream-form-grid">
          <TextInput
            type="date"
            label="Start, if useful"
            value={draft.start}
            onChange={(event) => setDraft({ ...draft, start: event.currentTarget.value })}
          />
          <TextInput
            type="date"
            label="By when, if known"
            value={draft.due}
            onChange={(event) => setDraft({ ...draft, due: event.currentTarget.value })}
          />
        </div>
        <Select
          label="State"
          data={['proposed', 'active', 'paused', 'completed', 'canceled']}
          value={draft.state}
          onChange={(state) => setDraft({ ...draft, state: state as Workstream['state'] })}
        />
        <Button
          variant="primary"
          disabled={busy || !draft.title.trim()}
          onClick={() =>
            onSave({
              ...draft,
              unknowns: draft.unknowns
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
              start: draft.start || undefined,
              due: draft.due || undefined,
            })
          }
        >
          Save understanding
        </Button>
      </div>
    </Modal>
  )
}
