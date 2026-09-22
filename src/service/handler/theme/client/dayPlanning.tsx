import './dayPlanning.css'
import { ActionIcon, Button, Checkbox, Drawer, Modal, Select, Textarea, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import {
  normalizeDayTime,
  type DayAddKind,
  type DayPlanInput,
  type DayPlanResult,
  type NextDayItem,
  type NextDestination,
} from '../../day/planningTypes.ts'
import type { DayData } from './day.tsx'
import { fileHref } from './explorer.tsx'

const LABELS: Record<DayAddKind, string> = {
  todos: 'to-do',
  commitments: 'commitment',
  reminders: 'reminder',
  complete: 'entry',
}

function PlanComposer({
  kind,
  opened,
  categories,
  busy,
  error,
  onOpen,
  onClose,
  onAdd,
}: {
  key?: string
  kind: DayAddKind
  opened: boolean
  categories: string[]
  busy: boolean
  error: string | null
  onOpen: () => void
  onClose: () => void
  onAdd: (input: DayPlanInput, requestId: string) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [category, setCategory] = useState('Professional')
  const [timed, setTimed] = useState(kind === 'commitments' || kind === 'complete')
  const [time, setTime] = useState('')
  const [invalidTime, setInvalidTime] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const request = useRef<{ payload: string; id: string } | null>(null)
  useEffect(() => {
    if (opened) {
      setText('')
      setTime('')
      setTimed(kind === 'commitments' || kind === 'complete')
      setInvalidTime(false)
      request.current = null
      field.current?.focus()
    } else if (wasOpen.current) trigger.current?.focus()
    wasOpen.current = opened
  }, [opened, kind])
  if (!opened)
    return (
      <Button
        ref={trigger}
        variant="secondary"
        className="sky-plan-add"
        disabled={busy}
        onClick={onOpen}
        leftSection={<span aria-hidden="true">＋</span>}
      >
        {kind === 'complete' ? 'Add entry' : `Add a ${LABELS[kind]}`}
      </Button>
    )
  const destination = kind === 'reminders' || kind === 'complete' ? kind : timed ? 'commitments' : 'todos'
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy || !text.trim()) return
    const normalized = timed ? normalizeDayTime(time) : null
    if (timed && !normalized) {
      setInvalidTime(true)
      return
    }
    const input: DayPlanInput = { kind: destination, text, category, ...(normalized ? { time: normalized } : {}) }
    const payload = JSON.stringify(input)
    if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() }
    void onAdd(input, request.current.id)
  }
  return (
    <form
      className="sky-plan-composer"
      aria-label={kind === 'complete' ? 'Add entry' : `Add a ${LABELS[kind]}`}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <Textarea
        ref={field}
        aria-label="Item text"
        placeholder={
          kind === 'complete'
            ? 'What happened?'
            : kind === 'reminders'
              ? 'What do you want to remember?'
              : 'What needs to happen?'
        }
        autosize
        minRows={1}
        maxRows={5}
        maxLength={4000}
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
      />
      <div className="sky-plan-compose-actions">
        {kind !== 'reminders' && (
          <Select
            aria-label="Category"
            className="sky-plan-category"
            data={categories}
            value={category}
            allowDeselect={false}
            disabled={busy}
            onChange={(value) => value && setCategory(value)}
          />
        )}
        {kind !== 'reminders' &&
          (timed ? (
            <div className="sky-plan-time">
              <TextInput
                aria-label={kind === 'complete' ? 'Entry time' : 'Commitment time'}
                placeholder="HH:MM"
                value={time}
                maxLength={5}
                disabled={busy}
                error={invalidTime}
                onChange={(event) => {
                  setTime(event.currentTarget.value)
                  setInvalidTime(false)
                }}
              />
              {kind !== 'complete' && (
                <ActionIcon
                  aria-label="Remove time"
                  title="Make this a to-do"
                  disabled={busy}
                  onClick={() => {
                    setTimed(false)
                    setInvalidTime(false)
                  }}
                >
                  ×
                </ActionIcon>
              )}
            </div>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => setTimed(true)}>
              Add a time
            </Button>
          ))}
        <span className="sky-spacer" />
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!text.trim()}>
          Add {LABELS[destination]}
        </Button>
      </div>
      {timed && kind !== 'complete' && <p className="sky-plan-note">A time makes this a commitment.</p>}
      {(invalidTime || error) && (
        <p className="sky-plan-error" role="alert">
          {invalidTime ? 'Enter a time as HH:MM, for example 09:30.' : error}
        </p>
      )}
    </form>
  )
}

function NextPicker({
  opened,
  busy,
  error,
  onClose,
  onLoad,
  onMove,
}: {
  key?: string
  opened: boolean
  busy: boolean
  error: string | null
  onClose: () => void
  onLoad: () => Promise<{ items: NextDayItem[] }>
  onMove: (kind: NextDestination, ids: string[], requestId: string) => Promise<void>
}) {
  const mobile = useMediaQuery('(max-width: 900px)')
  const [items, setItems] = useState<NextDayItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [kind, setKind] = useState<NextDestination>('todos')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [revision, setRevision] = useState(0)
  const request = useRef<{ payload: string; id: string } | null>(null)
  const load = useRef(onLoad)
  load.current = onLoad
  useEffect(() => {
    if (!opened) return
    let alive = true
    setItems(null)
    setLoadError(null)
    setSelected(new Set())
    request.current = null
    void load
      .current()
      .then((data) => {
        if (alive) setItems(data.items)
      })
      .catch((failure: Error) => {
        if (alive) setLoadError(failure.message)
      })
    return () => {
      alive = false
    }
  }, [opened, revision])
  const visible = (items ?? []).filter(
    (item) =>
      (filter === 'All' || item.category === filter) &&
      `${item.text} ${item.list} ${item.file}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const move = () => {
    if (busy || !selected.size) return
    const ids = [...selected].sort()
    const payload = JSON.stringify({ kind, ids })
    if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() }
    void onMove(kind, ids, request.current.id)
  }
  const body = (
    <div className="sky-next-picker">
      <div className="sky-next-tools">
        <p className="sky-plan-note">Bring a few things into this day from your Next lists.</p>
        <TextInput
          aria-label="Search next lists"
          placeholder="Search next lists…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div className="sky-next-filters" role="group" aria-label="Next list category">
          {['All', 'Professional', 'Personal'].map((label) => (
            <Button
              key={label}
              variant={filter === label ? 'secondary' : 'subtle'}
              aria-pressed={filter === label}
              onClick={() => setFilter(label)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="sky-next-options" aria-busy={items === null && !loadError}>
        {items === null && !loadError && (
          <p className="sky-plan-note" role="status">
            Loading next lists…
          </p>
        )}
        {items && !visible.length && (
          <p className="sky-plan-note">
            {items.length ? 'No items match this search.' : 'Your Next lists have no unfinished items.'}
          </p>
        )}
        {(['Professional', 'Personal'] as const).map((category) => {
          const rows = visible.filter((item) => item.category === category)
          const source = rows[0]
          if (!source) return null
          return (
            <section className="sky-next-group" key={category} aria-label={category}>
              <div className="sky-next-source">
                <span>{category}</span>
                <a href={fileHref(source.path)} target="_blank" rel="noreferrer">
                  {source.file} ↗
                </a>
              </div>
              {rows.map((item) => (
                <div
                  className="sky-next-option"
                  key={item.id}
                  data-disabled={item.already || Boolean(item.unavailable)}
                  data-selected={selected.has(item.id)}
                >
                  <Checkbox
                    label={
                      <span>
                        {item.text}
                        {(item.already || item.unavailable) && (
                          <small>{item.already ? 'Already on this day' : item.unavailable}</small>
                        )}
                      </span>
                    }
                    checked={selected.has(item.id)}
                    disabled={busy || item.already || Boolean(item.unavailable)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setSelected((previous) => {
                        const next = new Set(previous)
                        if (checked) next.add(item.id)
                        else next.delete(item.id)
                        return next
                      })
                    }}
                  />
                </div>
              ))}
            </section>
          )
        })}
      </div>
      {(loadError || error) && (
        <div className="sky-next-error">
          <p className="sky-plan-error" role="alert">
            {loadError || error}
          </p>
          <Button disabled={busy} onClick={() => setRevision((value) => value + 1)}>
            Refresh lists
          </Button>
        </div>
      )}
      <div className="sky-dialog-footer sky-next-footer">
        <div className="sky-next-move-controls">
          <span>{selected.size} selected</span>
          <Select
            aria-label="Move to"
            data={[
              { value: 'todos', label: 'To-dos' },
              { value: 'reminders', label: 'Reminders' },
            ]}
            value={kind}
            allowDeselect={false}
            disabled={busy}
            onChange={(value) => setKind(value as NextDestination)}
          />
          <Button variant="primary" disabled={!selected.size} loading={busy} onClick={move}>
            Move {selected.size || ''} to this day
          </Button>
        </div>
        <p className="sky-plan-note">Moved items leave their Next list. You can undo the move.</p>
      </div>
    </div>
  )
  const shared = {
    opened,
    onClose,
    title: 'From next lists',
    padding: 0,
    closeOnClickOutside: !busy,
    closeOnEscape: !busy,
    withCloseButton: !busy,
    classNames: { content: 'sky-next-dialog', body: 'sky-next-dialog-body' },
  }
  return mobile ? (
    <Drawer {...shared} position="bottom" size="90dvh">
      {body}
    </Drawer>
  ) : (
    <Modal {...shared} size={780} centered>
      {body}
    </Modal>
  )
}

export function useDayPlanning(
  day: DayData | null,
  applyView: (view: DayData) => void,
  dismissItemUndo: () => void,
  itemUndo: unknown,
) {
  const ymd = day?.day.ymd ?? ''
  const enabled = Boolean(
    day && !day.record.ended && (day.day.dayRelativePath || day.day.ymd >= (day.planningToday ?? day.today.ymd)),
  )
  const [active, setActive] = useState<DayAddKind | 'next' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ id: string; message: string; href?: string } | null>(null)
  const scope = `${ymd}/${enabled}`
  const current = useRef(scope)
  current.current = scope
  useEffect(() => {
    setActive(null)
    setBusy(false)
    setError(null)
    setUndo(null)
  }, [scope])
  useEffect(() => {
    if (itemUndo) setUndo(null)
  }, [itemUndo])
  useEffect(() => {
    if (!undo || busy) return
    const timer = setTimeout(() => setUndo(null), 8000)
    return () => clearTimeout(timer)
  }, [undo, busy])
  const request = async <T,>(route: string, body?: unknown): Promise<T> => {
    const response = await fetch(
      `/day/${ymd}/item/${route}`,
      body === undefined
        ? undefined
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    )
    const data = (await response.json()) as T & { error?: string; view?: DayData }
    if (current.current !== scope) throw new Error('The selected day changed.')
    if (!response.ok) {
      if (data.view) applyView(data.view)
      throw new Error(data.error ?? 'Could not save the item. Try again.')
    }
    return data
  }
  const save = async (route: 'add' | 'pull', body: unknown) => {
    if (busy || !enabled) return
    setBusy(true)
    setError(null)
    try {
      const result = await request<DayPlanResult>(route, body)
      applyView(result.view)
      dismissItemUndo()
      setUndo({ id: result.undo, message: result.message, href: result.href })
      setActive(null)
    } catch (failure) {
      if (current.current === scope) setError(failure instanceof Error ? failure.message : 'Could not save. Try again.')
    } finally {
      if (current.current === scope) setBusy(false)
    }
  }
  const revert = async () => {
    if (!undo || busy || !enabled) return
    setBusy(true)
    setError(null)
    try {
      applyView(await request<DayData>('undo', { id: undo.id }))
      setUndo(null)
    } catch (failure) {
      if (current.current === scope) setError(failure instanceof Error ? failure.message : 'Could not undo. Try again.')
    } finally {
      if (current.current === scope) setBusy(false)
    }
  }
  const categories = [
    ...new Set([
      'Professional',
      'Personal',
      ...(day
        ? [...day.record.todos, ...day.record.commitments].flatMap((item) => (item.category ? [item.category] : []))
        : []),
    ]),
  ]
  const open = (kind: DayAddKind | 'next') => {
    setActive(kind)
    setError(null)
  }
  return {
    editing: active !== null || busy,
    undo,
    dismissUndo: () => setUndo(null),
    composer: (kind: DayAddKind) =>
      enabled ? (
        <PlanComposer
          key={`${ymd}/${kind}`}
          kind={kind}
          opened={active === kind}
          categories={categories}
          busy={busy}
          error={error}
          onOpen={() => open(kind)}
          onClose={() => {
            setActive(null)
            setError(null)
          }}
          onAdd={(input, requestId) => save('add', { ...input, requestId })}
        />
      ) : null,
    nextButton: enabled ? (
      <Button variant="secondary" className="sky-plan-next" disabled={busy} onClick={() => open('next')}>
        From next lists
      </Button>
    ) : null,
    picker: enabled ? (
      <NextPicker
        key={ymd}
        opened={active === 'next'}
        busy={busy}
        error={error}
        onClose={() => {
          if (!busy) {
            setActive(null)
            setError(null)
          }
        }}
        onLoad={() => {
          setError(null)
          return request<{ items: NextDayItem[] }>('next')
        }}
        onMove={(kind, ids, requestId) => save('pull', { kind, ids, requestId })}
      />
    ) : null,
    toast:
      enabled && undo ? (
        <div className="sky-undo sky-plan-undo" role="status" key={undo.id}>
          <span className="sky-undo-text">{error && !active ? error : undo.message}</span>
          <Button variant="secondary" loading={busy} onClick={() => void revert()}>
            Undo
          </Button>
          {undo.href && (
            <Button component="a" href={undo.href} variant="secondary">
              Open schedule
            </Button>
          )}
          <ActionIcon
            aria-label="Dismiss notification"
            onClick={() => {
              setUndo(null)
              setError(null)
            }}
          >
            ×
          </ActionIcon>
          {!busy && (
            <span className="sky-undo-track">
              <span className="sky-undo-fill" />
            </span>
          )}
        </div>
      ) : null,
  }
}
