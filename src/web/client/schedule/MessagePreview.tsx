import { Button, Textarea } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import {
  type AvailabilityTemplate,
  availabilityMessage,
  defaultAvailabilityTemplate,
  defaultDayLineStyle,
  templateError,
} from '#lib/calendarScheduler/availabilityMessage.ts'
import type { AvailabilityDay } from '#lib/calendarScheduler/findTime.ts'
import { meetingRequest } from '../meetings/meetingRequest.ts'
import { TemplateEditor } from './TemplateEditor.tsx'

export function MessagePreview({
  active,
  days,
  updating,
  selection,
  timezone,
  startMinutes,
}: {
  active: boolean
  days: AvailabilityDay[] | null
  updating: boolean
  selection: ReadonlySet<string> | null
  timezone: string
  startMinutes?: number[]
}) {
  const [format, setFormat] = useState<AvailabilityTemplate | null>(null)
  const template = format?.template
  const [polished, setPolished] = useState<{ template: string; wording: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [copied, setCopied] = useState('')
  const [copyHelp, setCopyHelp] = useState(false)
  const preview = useRef<HTMLTextAreaElement>(null)
  const visible = active && days !== null

  useEffect(() => {
    if (!visible || format !== null) return
    const controller = new AbortController()
    setLoadError('')
    void meetingRequest<AvailabilityTemplate>('availability/template', undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setFormat({ ...defaultDayLineStyle, ...data })
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setLoadError(error.message)
      })
    return () => controller.abort()
  }, [visible, format, loadAttempt])

  // The model only words the template. Selecting a different range updates the bullets synchronously.
  useEffect(() => {
    if (!visible || !template || polished?.template === template) return
    const controller = new AbortController()
    void meetingRequest<{ template: string; wording: string }>('availability/wording', {}, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && data.template === template && !templateError(data.wording)) setPolished(data)
      })
      .catch(() => {
        /* The saved template is already ready to copy. */
      })
    return () => controller.abort()
  }, [visible, template, polished?.template])

  const message = availabilityMessage(
    (polished && polished.template === template ? polished.wording : template) ?? defaultAvailabilityTemplate,
    updating ? [] : (days ?? []),
    selection,
    timezone,
    format ?? undefined,
    startMinutes,
  )
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(message)
      setCopyHelp(false)
    } catch {
      preview.current?.focus()
      preview.current?.select()
      setCopyHelp(true)
    }
  }
  if (!days && !editing) return null
  return (
    <section className="sky-find-message" aria-label="Availability message">
      <div className="sky-find-section-head">
        <h2>Message preview</h2>
        <Button variant="primary-quiet" size="compact-sm" disabled={format === null} onClick={() => setEditing(true)}>
          Edit template
        </Button>
      </div>
      {loadError && (
        <p role="alert">
          Could not load your saved template. Showing the default. {loadError}{' '}
          <Button size="compact-xs" onClick={() => setLoadAttempt(loadAttempt + 1)}>
            Retry
          </Button>
        </p>
      )}
      <Textarea
        aria-label="Message preview"
        ref={preview}
        autosize
        minRows={3}
        readOnly
        value={message}
        placeholder={updating ? 'Updating openings…' : 'Select an opening to include it in your message.'}
      />
      <div className="sky-find-actions">
        {copyHelp && <span role="status">Preview selected. Use your device’s Copy command.</span>}
        <Button variant="primary" disabled={!message || (format === null && !loadError)} onClick={() => void copy()}>
          {message && copied === message ? 'Copied' : 'Copy availability'}
        </Button>
      </div>
      {editing && format && (
        <TemplateEditor
          active={active}
          initial={format}
          days={days ?? []}
          selection={selection}
          timezone={timezone}
          onSave={setFormat}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  )
}
