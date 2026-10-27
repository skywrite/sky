import { Button, Checkbox, Modal, Select, Textarea } from '@mantine/core'
import { useState } from 'react'
import { ActionPolicySchema, type ActionPolicy } from '#lib/workstreams/actionOutcome.ts'
import type { Activity, WorkstreamRecord } from '#lib/workstreams/types.ts'

export function ActionCompletionEditor({
  item,
  activity,
  policy,
  busy,
  onClose,
  onSave,
}: {
  item: WorkstreamRecord
  activity: Activity
  policy?: ActionPolicy
  busy: boolean
  onClose: () => void
  onSave: (policy: ActionPolicy | null) => void
}) {
  const [mode, setMode] = useState(policy ? 'deliverable' : 'review')
  const [criteria, setCriteria] = useState(policy?.successCriteria ?? activity.outcome)
  const [required, setRequired] = useState(policy?.requiredSourceIds ?? [])
  const [error, setError] = useState('')
  const save = () => {
    if (mode === 'review') {
      onSave(null)
      return
    }
    const parsed = ActionPolicySchema.safeParse({ mode, successCriteria: criteria, requiredSourceIds: required })
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(' '))
      return
    }
    onSave(parsed.data)
  }
  return (
    <Modal opened onClose={onClose} title="When can Sky call this done?" size="lg">
      <div className="sky-workstream-edit">
        <strong>{activity.title}</strong>
        <Select
          label="Completion responsibility"
          value={mode}
          onChange={(value) => setMode(value ?? 'review')}
          data={[
            { value: 'review', label: 'Bring the result to me for review' },
            { value: 'deliverable', label: 'Verify the agreed deliverable and mark it complete' },
          ]}
        />
        {mode === 'deliverable' && (
          <>
            <Textarea
              label="What must the deliverable accomplish?"
              description="Define the useful result Sky should verify against its work and sources."
              value={criteria}
              onChange={(event) => setCriteria(event.currentTarget.value)}
              autosize
              minRows={4}
            />
            <div className="sky-workstream-source-permissions">
              <strong>Required source evidence</strong>
              {item.sources.map((source) => (
                <Checkbox
                  key={source.id}
                  label={source.label || source.path}
                  checked={required.includes(source.id)}
                  onChange={(event) =>
                    setRequired(
                      event.currentTarget.checked
                        ? [...required, source.id]
                        : required.filter((id) => id !== source.id),
                    )
                  }
                />
              ))}
              {!item.sources.length && (
                <p className="sky-workstream-hint">You can add supporting sources in the workstream’s details.</p>
              )}
            </div>
            <p className="sky-workstream-hint">
              This authorizes completion of the deliverable described above. A signature, sent message, payment, or
              another external result still needs evidence that it happened.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="sky-workstreams-error">
            {error}
          </p>
        )}
        <Button variant="primary" disabled={busy || (mode === 'deliverable' && !criteria.trim())} onClick={save}>
          {mode === 'deliverable' ? 'Delegate completion' : 'Keep my review'}
        </Button>
      </div>
    </Modal>
  )
}
