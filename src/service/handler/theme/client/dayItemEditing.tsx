import './dayItemEditing.css'
import { Button, Drawer, Modal, Select, Textarea, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { itemEditFields, type DayEditFields, type DayEditKind } from '../../day/editingTypes.ts'
import { normalizeDayTime } from '../../day/planningTypes.ts'
import type { DayData, DayItem } from './day.tsx'
import { DayCalendarIcon, DayDatePicker, dayDateLabel } from './dayDatePicker.tsx'

const keyOf = (item: DayItem) => JSON.stringify([item.list, item.raw])
const editFields = (item: DayItem, date: string) => ({ ...itemEditFields(item), date })
interface Draft {
  item: DayItem
  fields: DayEditFields & { date: string }
  mode: 'inline' | 'details'
  selection?: string
}
interface Editing {
  draft: Draft | null
  busy: boolean
  error: string | null
  readOnly: boolean
  feedbackActive: boolean
  mobile: boolean
  today: string
  begin: (item: DayItem, mode: Draft['mode'], selection?: string) => void
  change: (fields: Partial<Draft['fields']>) => void
  details: () => void
  cancel: () => void
  save: () => void
  dismissUndo: () => void
}
const EditingContext = createContext<Editing | null>(null)
export const useItemEditing = () => useContext(EditingContext)!

/** Visual viewport follows the on-screen keyboard, including Safari's viewport panning. */
function useEditViewport(active: boolean): CSSProperties {
  const [viewport, setViewport] = useState({ height: window.innerHeight, top: 0, bottom: 0 })
  useEffect(() => {
    if (!active) return
    const visual = window.visualViewport
    const update = () =>
      setViewport({
        height: visual?.height ?? window.innerHeight,
        top: visual?.offsetTop ?? 0,
        bottom: Math.max(0, window.innerHeight - (visual?.height ?? window.innerHeight) - (visual?.offsetTop ?? 0)),
      })
    update()
    visual?.addEventListener('resize', update)
    visual?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      visual?.removeEventListener('resize', update)
      visual?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [active])
  return {
    '--sky-edit-height': `${viewport.height}px`,
    '--sky-edit-top': `${viewport.top}px`,
    '--sky-edit-bottom': `${viewport.bottom}px`,
  } as CSSProperties
}

export function DayItemEditing({
  day,
  applyView,
  dismissOtherUndo,
  otherUndo,
  onDelete,
  navigate,
  children,
}: {
  day: DayData | null
  applyView: (day: DayData) => void
  dismissOtherUndo: () => void
  otherUndo: unknown
  onDelete: (item: DayItem) => void
  navigate: (path: string) => void
  children: ReactNode
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ id: string; message: string; route: string; date?: string } | null>(null)
  const requestId = useRef<{ payload: string; id: string } | null>(null)
  const mobile = useMediaQuery('(max-width: 900px)') ?? false
  const viewport = useEditViewport(Boolean(draft) && mobile)
  const ymd = day?.day.ymd ?? ''
  const currentDay = useRef(ymd)
  currentDay.current = ymd
  const readOnly = Boolean(day?.record.ended || !day?.day.dayRelativePath)
  useEffect(() => {
    setDraft(null)
    setError(null)
    setUndo(null)
    setBusy(false)
    pending.current = false
    requestId.current = null
  }, [ymd])
  useEffect(() => {
    if (otherUndo) setUndo(null)
  }, [otherUndo])
  useEffect(() => {
    if (!undo || busy || error) return
    const timer = setTimeout(() => setUndo(null), 8000)
    return () => clearTimeout(timer)
  }, [undo, busy, error])
  // A refresh can remove or replace the row. Keep its unsaved draft accessible in Details.
  useEffect(() => {
    if (!draft || !day) return
    const items = [...day.record.todos, ...day.record.commitments, ...day.record.reminders, ...day.record.mostImportant]
    if (readOnly || !items.some((item) => keyOf(item) === keyOf(draft.item))) {
      setDraft((value) => (value ? { ...value, mode: 'details' } : null))
      setError(
        readOnly
          ? 'This day has ended. You can copy your draft, but it cannot be saved.'
          : 'This item changed elsewhere. Your draft is kept here; reload the day before trying again.',
      )
    }
  }, [day, readOnly])
  const restoreFocus = (item: { list: string; raw: string }) => {
    requestAnimationFrame(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('.sky-item-details')].find(
        (element) => element.dataset.item === JSON.stringify([item.list, item.raw.split(/\r?\n/)[0]]),
      )
      button?.focus({ preventScroll: true })
    })
  }
  const request = async <T,>(route: string, body: unknown): Promise<T> => {
    const response = await fetch(`/day/${ymd}/item/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = (await response.json()) as T & { error?: string; view?: DayData }
    if (currentDay.current !== ymd) throw new Error('The selected day changed.')
    if (!response.ok) {
      if (result.view) applyView(result.view)
      throw new Error(result.error ?? 'Could not save. Your draft is kept; try again.')
    }
    return result
  }
  const cancel = () => {
    if (pending.current) return
    if (draft) restoreFocus(draft.item)
    setDraft(null)
    setError(null)
  }
  const save = async () => {
    if (!draft || pending.current || readOnly) return
    const fields = { ...draft.fields, text: draft.fields.text.trim() }
    if (!fields.text) {
      setError('Enter text for the item.')
      return
    }
    if (draft.mode === 'details' && fields.time) {
      const time = normalizeDayTime(fields.time)
      if (!time) {
        setError('Enter a time as HH:MM, for example 09:30.')
        return
      }
      fields.time = time
    }
    if (draft.mode === 'details' && fields.kind === 'commitments' && !fields.time) {
      setError('Enter a time for this commitment.')
      return
    }
    if (JSON.stringify(fields) === JSON.stringify(editFields(draft.item, ymd))) {
      cancel()
      return
    }
    const input = {
      list: draft.item.list,
      raw: draft.item.raw,
      revision: draft.item.revision,
      ...(draft.mode === 'inline' ? { text: fields.text } : fields),
    }
    const payload = JSON.stringify(input)
    if (requestId.current?.payload !== payload) requestId.current = { payload, id: crypto.randomUUID() }
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await request<{
        view: DayData
        undo: string
        message: string
        item: { list: string; raw: string }
        undoRoute?: string
        date?: string
      }>('edit', { ...input, requestId: requestId.current.id })
      setDraft(null)
      applyView(result.view)
      dismissOtherUndo()
      setUndo({ id: result.undo, message: result.message, route: result.undoRoute ?? 'edit/undo', date: result.date })
      restoreFocus(result.item)
    } catch (failure) {
      if (currentDay.current === ymd)
        setError(failure instanceof Error ? failure.message : 'Could not save. Try again.')
    } finally {
      if (currentDay.current === ymd) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  const revert = async () => {
    if (!undo || pending.current || readOnly) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      applyView(await request<DayData>(undo.route, { id: undo.id }))
      setUndo(null)
    } catch (failure) {
      if (currentDay.current === ymd)
        setError(failure instanceof Error ? failure.message : 'Could not undo. Try again.')
    } finally {
      if (currentDay.current === ymd) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  const editor: Editing = {
    draft,
    busy,
    error,
    readOnly,
    feedbackActive: Boolean(draft || (undo && !readOnly)),
    mobile,
    today: day?.today.ymd ?? ymd,
    dismissUndo: () => setUndo(null),
    begin: (item, mode, selection) => {
      if (pending.current || readOnly || (draft && keyOf(draft.item) !== keyOf(item))) return
      dismissOtherUndo()
      setUndo(null)
      setError(null)
      const open = () =>
        setDraft((previous) =>
          previous ? { ...previous, mode } : { item, fields: editFields(item, ymd), mode, selection },
        )
      // Mount and focus during the tap so mobile browsers can open the keyboard.
      if (mobile && mode === 'inline') flushSync(open)
      else open()
      if (!draft) requestId.current = null
    },
    change: (fields) => {
      setDraft((value) => (value ? { ...value, fields: { ...value.fields, ...fields } } : null))
      setError(null)
    },
    details: () => setDraft((value) => (value ? { ...value, mode: 'details' } : null)),
    cancel,
    save: () => void save(),
  }
  const categories = [
    ...new Set([
      'Professional',
      'Personal',
      ...(day ? [...day.record.todos, ...day.record.commitments].map((item) => itemEditFields(item).category) : []),
      ...(draft ? [draft.fields.category] : []),
    ]),
  ]
  return (
    <EditingContext.Provider value={editor}>
      {children}
      {draft?.mode === 'details' && (
        <ItemDetails
          editor={editor}
          categories={categories}
          viewport={viewport}
          date={ymd}
          onDelete={() => {
            if (!busy && !readOnly) {
              setDraft(null)
              onDelete(draft.item)
            }
          }}
        />
      )}
      {draft?.mode === 'inline' &&
        mobile &&
        createPortal(
          <div className="sky-item-mobile-actions" style={viewport}>
            <Button variant="secondary" disabled={busy} onClick={editor.details}>
              Details
            </Button>
            <Button variant="secondary" disabled={busy} onClick={cancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={readOnly || !draft.fields.text.trim()}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>,
          document.body,
        )}
      {undo && !draft && !readOnly && (
        <div className="sky-undo sky-item-edit-undo" role="status">
          <span className="sky-undo-text">{error ?? undo.message}</span>
          <Button variant="secondary" loading={busy} onClick={() => void revert()}>
            Undo
          </Button>
          {undo.date && (
            <Button variant="secondary" disabled={busy} onClick={() => navigate(`/${undo.date}`)}>
              Open date
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={busy}
            aria-label="Dismiss notification"
            onClick={() => {
              setUndo(null)
              setError(null)
            }}
          >
            ×
          </Button>
        </div>
      )}
    </EditingContext.Provider>
  )
}

export function ItemDetailsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 10.5v6M12 7.5v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function InlineItemEditor() {
  const editor = useItemEditing()
  const field = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.focus({ preventScroll: true })
    const selected = editor.draft?.selection
    const at = selected ? element.value.indexOf(selected) : -1
    element.setSelectionRange(at < 0 ? element.value.length : at, at < 0 ? element.value.length : at + selected!.length)
    if (!editor.mobile) return
    const visual = window.visualViewport
    const reveal = () => {
      const scroll = element.closest<HTMLElement>('.sky-scroll')
      if (!scroll) return
      const bounds = element.getBoundingClientRect()
      const top = Math.max(visual?.offsetTop ?? 0, scroll.getBoundingClientRect().top) + 12
      const bottom = (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight) - 88
      if (bounds.top < top) scroll.scrollTop += bounds.top - top
      else if (bounds.bottom > bottom) scroll.scrollTop += Math.min(bounds.bottom - bottom, bounds.top - top)
    }
    const frame = requestAnimationFrame(reveal)
    visual?.addEventListener('resize', reveal)
    return () => {
      cancelAnimationFrame(frame)
      visual?.removeEventListener('resize', reveal)
    }
  }, [])
  if (!editor.draft) return null
  return (
    <div className="sky-item-inline">
      <Textarea
        ref={field}
        aria-label="Item text"
        autosize
        minRows={1}
        maxRows={6}
        maxLength={4000}
        value={editor.draft.fields.text}
        readOnly={editor.busy || editor.readOnly}
        onChange={(event) => editor.change({ text: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            editor.cancel()
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            editor.save()
          }
        }}
      />
      {!editor.mobile && (
        <div className="sky-item-inline-actions">
          <Button variant="secondary" disabled={editor.busy} onClick={editor.details}>
            Details
          </Button>
          <Button variant="secondary" disabled={editor.busy} onClick={editor.cancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={editor.busy}
            disabled={editor.readOnly || !editor.draft.fields.text.trim()}
            onClick={editor.save}
          >
            Save
          </Button>
        </div>
      )}
      {editor.error && (
        <p className="sky-plan-error" role="alert">
          {editor.error}
        </p>
      )}
    </div>
  )
}

function ItemDetails({
  editor,
  categories,
  viewport,
  date,
  onDelete,
}: {
  editor: Editing
  categories: string[]
  viewport: CSSProperties
  date: string
  onDelete: () => void
}) {
  const draft = editor.draft!
  const fields = draft.fields
  const [choosingDate, setChoosingDate] = useState(false)
  const dirty = JSON.stringify(fields) !== JSON.stringify(editFields(draft.item, date))
  const tomorrow = new PlainDate(editor.today).addDays(1).ymd
  const shared = {
    opened: true,
    onClose: editor.cancel,
    title: 'Item details',
    padding: 0,
    closeOnClickOutside: !dirty && !editor.busy,
    closeOnEscape: !editor.busy,
    withCloseButton: !editor.busy,
    closeButtonProps: { 'aria-label': 'Close item details' },
    returnFocus: false,
    classNames: { content: 'sky-item-dialog', body: 'sky-item-dialog-body' },
  }
  const body = (
    <form
      className="sky-item-form"
      onSubmit={(event) => {
        event.preventDefault()
        editor.save()
      }}
    >
      <div className="sky-item-fields">
        <Textarea
          label="Text"
          aria-label="Item text"
          autosize
          minRows={2}
          maxRows={8}
          maxLength={4000}
          value={fields.text}
          readOnly={editor.busy || editor.readOnly}
          onChange={(event) => editor.change({ text: event.currentTarget.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              editor.save()
            }
          }}
        />
        <Select
          label="Type"
          data={[
            { value: 'todos', label: 'To-do' },
            { value: 'commitments', label: 'Commitment' },
            { value: 'reminders', label: 'Reminder' },
            { value: 'important', label: 'Most important' },
          ]}
          value={fields.kind}
          allowDeselect={false}
          disabled={editor.busy || editor.readOnly}
          onChange={(kind) => {
            if (kind)
              editor.change({
                kind: kind as DayEditKind,
                time: ['todos', 'reminders'].includes(kind) ? '' : fields.time,
              })
          }}
        />
        {['todos', 'commitments'].includes(fields.kind) && (
          <Select
            label="Category"
            data={categories}
            value={fields.category}
            allowDeselect={false}
            disabled={editor.busy || editor.readOnly}
            onChange={(category) => {
              if (category) editor.change({ category })
            }}
          />
        )}
        <div className="sky-item-date">
          <span className="sky-item-date-label" id="sky-item-date-label">
            Date
          </span>
          <button
            type="button"
            className="sky-item-date-value"
            aria-labelledby="sky-item-date-label sky-item-date-value"
            disabled={editor.busy || editor.readOnly}
            onClick={() => setChoosingDate(true)}
          >
            <DayCalendarIcon />
            <span id="sky-item-date-value">{dayDateLabel(fields.date)}</span>
            <span aria-hidden="true">›</span>
          </button>
          <div className="sky-item-date-actions">
            <Button
              variant="secondary"
              disabled={editor.busy || editor.readOnly || fields.date === tomorrow}
              onClick={() => editor.change({ date: tomorrow })}
            >
              Tomorrow
            </Button>
            <Button variant="secondary" disabled={editor.busy || editor.readOnly} onClick={() => setChoosingDate(true)}>
              Choose date…
            </Button>
          </div>
        </div>
        {['commitments', 'important'].includes(fields.kind) ? (
          <div className="sky-item-time">
            <TextInput
              label={fields.kind === 'important' ? 'Time (optional)' : 'Time'}
              placeholder="HH:MM"
              value={fields.time}
              maxLength={5}
              disabled={editor.busy || editor.readOnly}
              onChange={(event) => editor.change({ time: event.currentTarget.value })}
            />
            {(fields.time || fields.kind === 'commitments') && (
              <Button
                variant="secondary"
                disabled={editor.busy || editor.readOnly}
                onClick={() => editor.change({ time: '', kind: fields.kind === 'commitments' ? 'todos' : fields.kind })}
              >
                Remove time
              </Button>
            )}
          </div>
        ) : (
          fields.kind === 'todos' && (
            <Button
              variant="secondary"
              disabled={editor.busy || editor.readOnly}
              onClick={() => editor.change({ kind: 'commitments' })}
            >
              Add a time
            </Button>
          )
        )}
        {editor.error && (
          <p className="sky-plan-error" role="alert">
            {editor.error}
          </p>
        )}
      </div>
      <div className="sky-dialog-footer sky-item-footer">
        <Button variant="danger-quiet" disabled={editor.busy || editor.readOnly} onClick={onDelete}>
          Delete
        </Button>
        <span className="sky-spacer" />
        <Button variant="secondary" disabled={editor.busy} onClick={editor.cancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={editor.busy}
          disabled={editor.readOnly || !fields.text.trim() || !dirty}
        >
          Save changes
        </Button>
      </div>
    </form>
  )
  const dialog = editor.mobile ? (
    <Drawer {...shared} position="bottom" size="auto" style={viewport} className="sky-item-sheet">
      {body}
    </Drawer>
  ) : (
    <Modal {...shared} centered size={620}>
      {body}
    </Modal>
  )
  return (
    <>
      {dialog}
      {choosingDate && (
        <DayDatePicker
          today={editor.today}
          initial={fields.date}
          title="Choose a date"
          confirmLabel="Use this date"
          onClose={() => setChoosingDate(false)}
          onChoose={(date) => {
            editor.change({ date })
            setChoosingDate(false)
          }}
        />
      )}
    </>
  )
}
