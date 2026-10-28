import { Button, Checkbox, Modal, Select, Textarea, TextInput } from '@mantine/core'
import { useState } from 'react'
import type { Activity, WorkstreamRecord } from '#lib/workstreams/types.ts'

export function CommunicationEditor({
  item,
  activity,
  busy,
  onClose,
  onSave,
}: {
  item: WorkstreamRecord
  activity: Activity
  busy: boolean
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => void
}) {
  const [title, setTitle] = useState(activity.title)
  const [medium, setMedium] = useState('Email')
  const [destination, setDestination] = useState('')
  const [sourceRef, setSourceRef] = useState('')
  const [draft, setDraft] = useState('')
  const [decisions, setDecisions] = useState<string[]>([])
  return (
    <Modal opened onClose={onClose} title="Prepare a message in Outbox" size="lg">
      <div className="sky-workstream-edit">
        <p>Prepare the communication with its workstream context. Review and placement happen in Outbox.</p>
        <TextInput label="Title" value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
        <div className="sky-workstream-form-grid">
          <Select
            label="Medium"
            value={medium}
            data={['Email', 'Slack']}
            onChange={(value) => setMedium(value ?? 'Email')}
          />
          <TextInput label="To" value={destination} onChange={(event) => setDestination(event.currentTarget.value)} />
        </div>
        <TextInput
          label="Saved conversation, if replying"
          description="A notebook reference to the captured message identifies its verified destination."
          value={sourceRef}
          onChange={(event) => setSourceRef(event.currentTarget.value)}
        />
        <Textarea
          label="Draft"
          autosize
          minRows={7}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        {item.activities.some((value) => value.kind === 'decision') && (
          <div className="sky-workstream-source-permissions">
            <strong>Decisions this message depends on</strong>
            {item.activities
              .filter((value) => value.kind === 'decision')
              .map((value) => (
                <Checkbox
                  key={value.id}
                  label={value.title}
                  checked={decisions.includes(value.id)}
                  onChange={(event) =>
                    setDecisions(
                      event.currentTarget.checked
                        ? [...decisions, value.id]
                        : decisions.filter((id) => id !== value.id),
                    )
                  }
                />
              ))}
          </div>
        )}
        <Button
          variant="primary"
          disabled={busy || !draft.trim() || !title.trim()}
          onClick={() =>
            onSave({
              title,
              medium,
              destination,
              sourceRef: sourceRef.trim() || undefined,
              draft,
              decisionIds: decisions,
            })
          }
        >
          Prepare for review
        </Button>
      </div>
    </Modal>
  )
}
