import { Alert, Button, Modal, Textarea, TextInput } from '@mantine/core'
import { useState } from 'react'
import {
  type AvailabilityTemplate,
  formatDayLine,
  formatErrors,
  selectedTimes,
} from '#lib/calendarScheduler/availabilityMessage.ts'
import type { AvailabilityDay } from '#lib/calendarScheduler/findTime.ts'
import { useDialogTitle } from '../lib/useDialogTitle.ts'
import { MeetingRequestError, meetingRequest } from '../meetings/meetingRequest.ts'

export function TemplateEditor({
  active,
  initial,
  days,
  selection,
  timezone,
  onSave,
  onClose,
}: {
  active: boolean
  initial: AvailabilityTemplate
  days: AvailabilityDay[]
  selection: ReadonlySet<string> | null
  timezone: string
  onSave: (format: AvailabilityTemplate) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [problem, setProblem] = useState('')
  useDialogTitle(active ? 'sky · Edit availability template' : null)
  const errors = formatErrors(draft)
  const invalid = Object.values(errors).some(Boolean)
  const choices = days.map((day) => ({ day, times: selectedTimes(day, selection) }))
  const example = choices.find(({ times }) => times.length > 1) ?? choices.find(({ times }) => times.length)
  const preview = formatDayLine(
    draft,
    example?.day ?? { label: 'Mon, May 6', weekday: 'Monday', monthDay: 'May 6' },
    example?.times ?? ['9–10 am', '1–3 pm'],
    timezone,
  )

  const save = async () => {
    setSaving(true)
    setProblem('')
    try {
      const saved = await meetingRequest<AvailabilityTemplate>('availability/template', {
        previous: initial,
        format: draft,
      })
      onSave(saved)
      onClose()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save the availability template.')
      setConflict(error instanceof MeetingRequestError && error.status === 409)
    } finally {
      setSaving(false)
    }
  }
  const loadLatest = async () => {
    setSaving(true)
    try {
      const latest = await meetingRequest<AvailabilityTemplate>('availability/template')
      onSave(latest)
      setDraft(latest)
      setProblem('')
      setConflict(false)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not load the saved template.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      opened={active}
      centered
      size="lg"
      title="Edit availability template"
      onClose={() => {
        if (!saving) onClose()
      }}
    >
      <div className="sky-find-template-fields">
        <Textarea
          label="Email template"
          description="Place {{days}} on its own line. Put {{timezone}} in the email or the day line."
          autosize
          minRows={5}
          maxRows={10}
          maxLength={4000}
          value={draft.template}
          onChange={(event) => setDraft({ ...draft, template: event.currentTarget.value })}
          error={errors.template || undefined}
          disabled={saving}
        />
        <div className="sky-find-template-style">
          <TextInput
            label="Day line"
            description="Use {{day}} for the day and date, or {{weekday}} and {{date}} separately. {{times}} lists the openings."
            inputWrapperOrder={['label', 'input', 'description', 'error']}
            value={draft.dayLine}
            maxLength={500}
            disabled={saving}
            onChange={(event) => setDraft({ ...draft, dayLine: event.currentTarget.value })}
            error={errors.dayLine || undefined}
          />
          <TextInput
            label="Between openings"
            description="Include any spaces you want."
            inputWrapperOrder={['label', 'input', 'description', 'error']}
            value={draft.timeSeparator}
            maxLength={80}
            disabled={saving}
            onChange={(event) => setDraft({ ...draft, timeSeparator: event.currentTarget.value })}
            error={errors.timeSeparator || undefined}
          />
        </div>
        <div className="sky-find-template-example">
          <span>{example ? 'Day line preview' : 'Example day line'}</span>
          <output aria-label="Day line preview">{preview}</output>
        </div>
        {problem && (
          <Alert color="red" role="alert">
            {problem}{' '}
            {conflict && (
              <Button size="compact-sm" disabled={saving} onClick={() => void loadLatest()}>
                Replace my edits with the saved version
              </Button>
            )}
          </Alert>
        )}
      </div>
      <div className="sky-find-actions">
        <Button disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={conflict || invalid} loading={saving} onClick={() => void save()}>
          Save template
        </Button>
      </div>
    </Modal>
  )
}
