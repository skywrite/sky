import { Button, Drawer, Modal, Select, Textarea, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useEffect, useState } from 'react'
import { canonicalRecurringPattern, recurringPatternLabel } from '#universal/dates/recurring/display.ts'
import type {
  RecurringDraft,
  RecurringFile,
  RecurringItem,
  RecurringReport,
  RecurringSource,
} from '../../../service/handler/recurring/types.ts'
import { fileHref } from '../explorer/explorer.tsx'
import { recurringApi, recurringRevisions } from './api.ts'
import { RepeatFields } from './RepeatFields.tsx'

export function Editor({
  item,
  files,
  defaultSource,
  onClose,
  onSaved,
  stop = false,
}: {
  item: RecurringItem | null
  files: RecurringFile[]
  defaultSource: RecurringSource | 'all'
  onClose: () => void
  onSaved: (report: RecurringReport, message: string) => void
  stop?: boolean
}) {
  const [draft, setDraft] = useState<RecurringDraft>(() =>
    item
      ? {
          text: item.text,
          notes: item.notes,
          kind: item.kind,
          category: item.category,
          time: item.time,
          pattern: canonicalRecurringPattern(item.pattern) ?? item.pattern,
        }
      : {
          text: '',
          notes: '',
          kind: defaultSource === 'reminders' ? 'reminder' : 'todo',
          category: defaultSource === 'personal' ? 'Personal' : 'Professional',
          time: '',
          pattern: 'EVERY-WEEKDAY',
        },
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState(stop)
  const [notesOpen, setNotesOpen] = useState(Boolean(item?.notes))
  const [preview, setPreview] = useState<{ dates: string[]; error: string } | null>(null)
  const mobile = useMediaQuery('(max-width: 900px)') ?? false
  const change = (update: Partial<RecurringDraft>) => setDraft((value) => ({ ...value, ...update }))
  useEffect(() => {
    document.title = 'sky · ' + (draft.text.trim() || 'New recurring item') + ' · Recurring'
  }, [draft.text])
  useEffect(() => {
    const abort = new AbortController()
    setPreview(null)
    const timer = setTimeout(() => {
      void recurringApi<{ dates: string[] }>(
        '/preview?pattern=' + encodeURIComponent(draft.pattern),
        undefined,
        abort.signal,
      )
        .then((value) => {
          if (!abort.signal.aborted) setPreview({ dates: value.dates, error: '' })
        })
        .catch((problem) => {
          if (!abort.signal.aborted) setPreview({ dates: [], error: (problem as Error).message })
        })
    }, 150)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [draft.pattern])
  const source = files.find((file) => file.source === item?.source)
  const destination =
    draft.kind === 'reminder' ? 'Reminders' : draft.category + (draft.kind === 'commitment' ? ' Commitments' : ' Todos')
  const save = async (remove = false) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const report = await recurringApi<RecurringReport>(remove ? '/remove' : '/save', {
        id: item?.id,
        revisions: recurringRevisions(files),
        ...(remove ? {} : { draft }),
      })
      onSaved(
        report,
        remove
          ? 'Stopped repeating. Existing day entries kept.'
          : item
            ? 'Recurrence updated. Existing day entries kept.'
            : 'Recurring item added.',
      )
    } catch (problem) {
      setError((problem as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const errorMessage = error && (
    <div className="sky-recurring-error" role="alert">
      <p>{error}</p>
      {source?.exists && (
        <a href={fileHref(source.path)} target="_blank" rel="noreferrer">
          Review the source file
        </a>
      )}
    </div>
  )
  const body = stopping ? (
    <div className="sky-recurring-form">
      <p>“{item?.text}” will stop being added to matching days. Entries already on your days will stay.</p>
      {errorMessage}
      <div className="sky-dialog-actions">
        <Button
          onClick={() => {
            if (stop) onClose()
            else {
              setStopping(false)
              setError('')
            }
          }}
          disabled={busy}
        >
          Keep repeating
        </Button>
        <Button variant="danger" loading={busy} onClick={() => void save(true)}>
          Stop repeating
        </Button>
      </div>
    </div>
  ) : (
    <form
      className="sky-recurring-form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <TextInput
        label="What?"
        placeholder="What would you like to come back to?"
        value={draft.text}
        onChange={(event) => change({ text: event.currentTarget.value })}
        disabled={busy}
        required
        data-autofocus
      />
      {!notesOpen ? (
        <Button
          className="sky-recurring-notes-toggle"
          variant="secondary"
          onClick={() => setNotesOpen(true)}
          disabled={busy}
        >
          Add notes
        </Button>
      ) : (
        <Textarea
          label="Notes"
          description="Markdown and nested lists are supported."
          value={draft.notes}
          onChange={(event) => change({ notes: event.currentTarget.value })}
          disabled={busy}
          autosize
          minRows={2}
          maxRows={10}
        />
      )}
      <div className="sky-recurring-fields">
        <Select
          label="Type"
          data={[
            { value: 'todo', label: 'To-do' },
            { value: 'commitment', label: 'Commitment' },
            { value: 'reminder', label: 'Reminder' },
          ]}
          value={draft.kind}
          onChange={(kind) =>
            kind && change({ kind: kind as RecurringDraft['kind'], time: kind === 'commitment' ? draft.time : '' })
          }
          disabled={busy}
          allowDeselect={false}
        />
        {draft.kind !== 'reminder' && (
          <Select
            label="Category"
            data={['Professional', 'Personal']}
            value={draft.category}
            onChange={(category) => category && change({ category: category as RecurringDraft['category'] })}
            disabled={busy}
            allowDeselect={false}
          />
        )}
      </div>
      {draft.kind === 'commitment' && (
        <TextInput
          label="Time"
          placeholder="09:00"
          value={draft.time}
          onChange={(event) => change({ time: event.currentTarget.value })}
          disabled={busy}
          required
          inputMode="numeric"
        />
      )}
      <RepeatFields value={draft.pattern} onChange={(pattern) => change({ pattern })} disabled={busy} />
      <div className="sky-recurring-preview" aria-live="polite">
        <span>{recurringPatternLabel(draft.pattern)}</span>
        {preview?.error ? (
          <p role="alert">{preview.error}</p>
        ) : (
          <div className="sky-recurring-dates" aria-label="Next matching dates">
            {preview ? (
              preview.dates.map((date) => (
                <time key={date} dateTime={date}>
                  {date}
                </time>
              ))
            ) : (
              <span>Checking next dates…</span>
            )}
          </div>
        )}
      </div>
      <p className="sky-recurring-help">
        Added to {destination} when you start a matching day.{item ? ' Existing day entries stay as written.' : ''}
      </p>
      {errorMessage}
      <div className="sky-recurring-editor-actions">
        {item && (
          <Button
            variant="danger-quiet"
            disabled={busy}
            onClick={() => {
              setStopping(true)
              setError('')
            }}
          >
            Stop repeating
          </Button>
        )}
        <div className="sky-dialog-actions">
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={
              !draft.text.trim() ||
              !canonicalRecurringPattern(draft.pattern) ||
              (draft.kind === 'commitment' && !draft.time.trim())
            }
          >
            {item ? 'Save changes' : 'Add recurring item'}
          </Button>
        </div>
      </div>
    </form>
  )
  const props = {
    opened: true,
    onClose: () => {
      if (!busy) onClose()
    },
    title: stopping ? 'Stop repeating?' : item ? 'Edit recurring item' : 'Add recurring item',
    closeOnClickOutside: !busy,
    closeOnEscape: !busy,
    withCloseButton: !busy,
  }
  return mobile ? (
    <Drawer {...props} position="bottom" size="auto">
      {body}
    </Drawer>
  ) : (
    <Modal {...props} centered size={620}>
      {body}
    </Modal>
  )
}
