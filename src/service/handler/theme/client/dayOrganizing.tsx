import './dayOrganizing.css'
import { Button, NativeSelect } from '@mantine/core'
import { createContext, type PointerEvent as ReactPointerEvent, useContext, useEffect, useRef, useState } from 'react'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dayItemKey, type CommitmentOrder } from '../../day/organizingTypes.ts'
import type { DayData, DayItem } from './day.tsx'
import { DayCalendarIcon, DayDatePicker } from './dayDatePicker.tsx'
import { useItemEditing } from './dayItemEditing.tsx'

type Result = { view: DayData; undo: string; message: string; date?: string }
type Drag = {
  item: DayItem
  x: number
  y: number
  startX: number
  startY: number
  active: boolean
  target: DayItem | null
  after: boolean
  scroll: HTMLElement | null
}
const allItems = (day: DayData | null) =>
  day ? [...day.record.mostImportant, ...day.record.commitments, ...day.record.todos, ...day.record.reminders] : []
const canMove = (item: DayItem) => Boolean(item.revision)

export function useDayOrganizing(
  day: DayData | null,
  applyView: (view: DayData) => void,
  dismissOtherUndo: () => void,
  otherUndo: unknown,
  navigate: (path: string) => void,
) {
  const ymd = day?.day.ymd ?? ''
  const enabled = Boolean(day?.day.dayRelativePath && !day.record.ended)
  const scope = `${ymd}/${enabled}`
  const current = useRef(scope)
  current.current = scope
  const [active, setActive] = useState(false)
  const [selected, setSelected] = useState<Map<string, DayItem>>(new Map())
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<Omit<Result, 'view'> | null>(null)
  const [datePicker, setDatePicker] = useState(false)
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const drag = useRef<Drag | null>(null)
  const frame = useRef(0)
  const requestId = useRef<{ payload: string; id: string } | null>(null)
  const focusAfterSave = useRef<string | null>(null)
  const items = allItems(day)
  const cancelDrag = () => {
    drag.current = null
    cancelAnimationFrame(frame.current)
    setDragging(null)
    setDrop(null)
  }
  useEffect(() => {
    setActive(false)
    setSelected(new Map())
    setUndo(null)
    setError(null)
    setBusy(false)
    setDatePicker(false)
    pending.current = false
    requestId.current = null
    cancelDrag()
    return () => {
      drag.current = null
      cancelAnimationFrame(frame.current)
    }
  }, [scope])
  useEffect(() => {
    if (otherUndo) setUndo(null)
  }, [otherUndo])
  useEffect(() => {
    if (!undo || busy || error) return
    const timer = setTimeout(() => setUndo(null), 8000)
    return () => clearTimeout(timer)
  }, [undo, busy, error])
  useEffect(() => {
    setSelected((previous) => {
      const next = new Map(
        [...previous].filter(([key, selected]) =>
          items.some((item) => dayItemKey(item) === key && item.revision === selected.revision),
        ),
      )
      if (next.size === previous.size) return previous
      if (next.size === 0) setDatePicker(false)
      return next
    })
  }, [day])
  const request = async <T,>(route: string, input: unknown): Promise<T> => {
    const response = await fetch(`/day/${ymd}/item/organize/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body = (await response.json()) as T & { error?: string; view?: DayData }
    if (current.current !== scope) throw new Error('The selected day changed.')
    if (!response.ok) {
      if (body.view) applyView(body.view)
      throw new Error(body.error ?? 'Could not save this change. Try again.')
    }
    return body
  }
  const save = async (route: 'move' | 'reorder' | 'order', input: unknown) => {
    if (!enabled || pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    const payload = JSON.stringify({ route, input })
    if (requestId.current?.payload !== payload) requestId.current = { payload, id: crypto.randomUUID() }
    try {
      const result = await request<Result>(route, { ...(input as object), requestId: requestId.current.id })
      requestId.current = null
      applyView(result.view)
      dismissOtherUndo()
      setUndo(result)
      if (route === 'reorder' && focusAfterSave.current) {
        const key = focusAfterSave.current
        requestAnimationFrame(() => {
          const row = [...document.querySelectorAll<HTMLElement>('[data-organize-key]')].find(
            (node) => node.dataset.organizeKey === key,
          )
          row?.querySelector<HTMLButtonElement>('[data-sort-grip]')?.focus({ preventScroll: true })
        })
      }
      if (route === 'move') {
        setActive(false)
        setSelected(new Map())
        setDatePicker(false)
      }
    } catch (failure) {
      if (current.current === scope) setError(failure instanceof Error ? failure.message : 'Could not save. Try again.')
    } finally {
      if (current.current === scope) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  const revert = async () => {
    if (!undo || !enabled || pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      applyView(await request<DayData>('undo', { id: undo.undo }))
      requestId.current = null
      setUndo(null)
    } catch (failure) {
      if (current.current === scope) setError(failure instanceof Error ? failure.message : 'Could not undo. Try again.')
    } finally {
      if (current.current === scope) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  const address = ({ list, raw, revision }: DayItem) => ({ list, raw, revision })
  const reorder = (item: DayItem, neighbor: DayItem, after: boolean) => {
    if (item.list !== neighbor.list || dayItemKey(item) === dayItemKey(neighbor)) return
    const rows = items.filter((row) => row.list === item.list)
    const ordered = rows.filter((row) => dayItemKey(row) !== dayItemKey(item))
    ordered.splice(ordered.findIndex((row) => dayItemKey(row) === dayItemKey(neighbor)) + (after ? 1 : 0), 0, item)
    if (ordered.every((row, index) => dayItemKey(row) === dayItemKey(rows[index]))) return
    focusAfterSave.current = dayItemKey(item)
    void save('reorder', { list: item.list, items: ordered.map(address) })
  }
  const canReorder = (item: DayItem) =>
    enabled &&
    !busy &&
    Boolean(item.revision) &&
    (!/commitments$/i.test(item.list) || day?.record.commitmentsOrder === 'manual')
  const point = () => {
    const state = drag.current
    if (!state?.active) return
    const row = document
      .elementsFromPoint(state.x, state.y)
      .map((node) => node.closest<HTMLElement>('[data-organize-key]'))
      .find(
        (node) =>
          node && node.dataset.organizeKey !== dayItemKey(state.item) && node.dataset.organizeList === state.item.list,
      )
    if (row) {
      state.target = items.find((item) => dayItemKey(item) === row.dataset.organizeKey) ?? null
      const bounds = row.getBoundingClientRect()
      state.after = state.y > bounds.top + bounds.height / 2
      setDrop({ key: row.dataset.organizeKey!, after: state.after })
    } else {
      state.target = null
      setDrop(null)
    }
  }
  const scrollDrag = () => {
    const state = drag.current
    if (!state?.active) return
    if (state.scroll) {
      const bounds = state.scroll.getBoundingClientRect()
      const speed = state.y < bounds.top + 48 ? -10 : state.y > bounds.bottom - 48 ? 10 : 0
      if (speed) {
        state.scroll.scrollTop += speed
        point()
      }
    }
    frame.current = requestAnimationFrame(scrollDrag)
  }
  const gripHandlers = (item: DayItem) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!canReorder(item) || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = {
        item,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        target: null,
        after: false,
        scroll: event.currentTarget.closest('.sky-scroll'),
      }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const state = drag.current
      if (!state) return
      state.x = event.clientX
      state.y = event.clientY
      if (!state.active && Math.hypot(state.x - state.startX, state.y - state.startY) > 5) {
        state.active = true
        setDragging(dayItemKey(item))
        frame.current = requestAnimationFrame(scrollDrag)
      }
      if (state.active) point()
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      const state = drag.current
      if (state?.active && state.target) reorder(state.item, state.target, state.after)
      cancelDrag()
    },
    onPointerCancel: cancelDrag,
    onLostPointerCapture: cancelDrag,
  })
  const toggle = (item: DayItem) => {
    if (!active || busy || !canMove(item)) return
    setSelected((previous) => {
      const next = new Map(previous),
        key = dayItemKey(item)
      if (next.has(key)) next.delete(key)
      else if (next.size < 100) next.set(key, item)
      return next
    })
  }
  const finish = () => {
    if (!pending.current) {
      setActive(false)
      setSelected(new Map())
      setError(null)
      cancelDrag()
    }
  }
  return {
    active,
    enabled,
    selected,
    busy,
    error,
    undo,
    dragging,
    drop,
    canMove,
    canReorder,
    toggle,
    finish,
    gripHandlers,
    manualOrder: day?.record.manualOrder ?? [],
    commitmentsOrder: day?.record.commitmentsOrder ?? 'time',
    dismissUndo: () => {
      setUndo(null)
      setError(null)
    },
    start: () => {
      if (enabled && !pending.current) {
        setActive(true)
        setSelected(new Map())
        setUndo(null)
        setError(null)
        dismissOtherUndo()
      }
    },
    eligible: items.filter(canMove),
    hasItems: items.some((item) => item.revision),
    selectAll: () =>
      setSelected((previous) =>
        items
          .filter(canMove)
          .slice(0, 100)
          .every((item) => previous.has(dayItemKey(item)))
          ? new Map()
          : new Map(
              items
                .filter(canMove)
                .slice(0, 100)
                .map((item) => [dayItemKey(item), item]),
            ),
      ),
    changeOrder: (order: CommitmentOrder) => void save('order', { order }),
    chooseDate: () => setDatePicker(true),
    moveTomorrow: () =>
      void save('move', {
        items: [...selected.values()].map(address),
        date: new PlainDate(day!.today.ymd).addDays(1).ymd,
      }),
    tomorrowIsCurrent: Boolean(day && ymd === new PlainDate(day.today.ymd).addDays(1).ymd),
    revert: () => void revert(),
    openDate: () => {
      if (undo?.date) navigate(`/${undo.date}`)
    },
    step: (item: DayItem, direction: -1 | 1) => {
      const nodes = [...document.querySelectorAll<HTMLElement>('[data-organize-key]')].filter(
        (node) => node.dataset.organizeList === item.list,
      )
      const at = nodes.findIndex((node) => node.dataset.organizeKey === dayItemKey(item))
      const key = nodes[at + direction]?.dataset.organizeKey
      const neighbor = items.find((row) => dayItemKey(row) === key)
      if (neighbor) reorder(item, neighbor, direction === 1)
    },
    refresh: async () => {
      if (busy) return
      const response = await fetch(`/day/${ymd}`)
      if (response.ok && current.current === scope) {
        applyView((await response.json()) as DayData)
        setSelected(new Map())
        setError(null)
      }
    },
    picker:
      datePicker && selected.size > 0 && day ? (
        <DayDatePicker
          today={day.today.ymd}
          initial={new PlainDate(day.today.ymd).addDays(1).ymd}
          exclude={ymd}
          title={`Move ${selected.size} ${selected.size === 1 ? 'item' : 'items'}`}
          confirmLabel={`Move ${selected.size} ${selected.size === 1 ? 'item' : 'items'}`}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) setDatePicker(false)
          }}
          onChoose={(date) => void save('move', { items: [...selected.values()].map(address), date })}
        />
      ) : null,
  }
}

export const DayOrganizingContext = createContext<ReturnType<typeof useDayOrganizing> | null>(null)
export const useItemOrganizing = () => useContext(DayOrganizingContext)!

export function DayOrganizeButton({ disabled }: { disabled: boolean }) {
  const organize = useItemOrganizing(),
    editor = useItemEditing()
  if (!organize.enabled || !organize.hasItems) return null
  return (
    <Button
      variant="secondary"
      className="sky-organize-trigger"
      aria-pressed={organize.active}
      disabled={disabled || organize.busy || editor.busy || Boolean(editor.draft)}
      onClick={() => {
        editor.dismissUndo()
        if (organize.active) organize.finish()
        else organize.start()
      }}
    >
      {organize.active ? 'Organizing' : 'Organize'}
    </Button>
  )
}

export function DayCommitmentOrder() {
  const organize = useItemOrganizing(),
    editor = useItemEditing()
  if (!organize.enabled) return null
  return (
    <NativeSelect
      className="sky-commitment-order"
      aria-label="Commitment order"
      value={organize.commitmentsOrder}
      data={[
        { value: 'time', label: 'Time order' },
        { value: 'manual', label: 'Manual order' },
      ]}
      disabled={organize.busy || editor.busy || Boolean(editor.draft)}
      onChange={(event) => {
        editor.dismissUndo()
        organize.changeOrder(event.currentTarget.value as CommitmentOrder)
      }}
    />
  )
}

export function DayOrganizingHint() {
  const organize = useItemOrganizing()
  if (!organize.active) return null
  return (
    <div className="sky-organize-hint">
      <span>Select items to move, or drag to reorder.</span>
      {organize.eligible.length > 0 && (
        <Button variant="primary-quiet" disabled={organize.busy} onClick={organize.selectAll}>
          {organize.eligible.slice(0, 100).every((item) => organize.selected.has(dayItemKey(item)))
            ? 'Deselect all'
            : organize.eligible.length > 100
              ? 'Select first 100'
              : 'Select all'}
        </Button>
      )}
    </div>
  )
}

export function DayOrganizingBar() {
  const organize = useItemOrganizing()
  if (!organize.active) return null
  return (
    <div className="sky-organize-bar" aria-label="Organize items">
      <span className="sky-organize-count" role="status">
        {organize.selected.size ? `${organize.selected.size} selected` : 'Select items to move'}
      </span>
      <Button variant="secondary" className="sky-organize-done" disabled={organize.busy} onClick={organize.finish}>
        Done
      </Button>
      {organize.selected.size > 0 && (
        <>
          <Button
            variant="primary"
            className="sky-organize-tomorrow"
            disabled={organize.busy || organize.tomorrowIsCurrent}
            onClick={organize.moveTomorrow}
          >
            <span className="sky-desktop-label">Move to tomorrow</span>
            <span className="sky-mobile-label">Tomorrow</span>
          </Button>
          <Button
            variant="secondary"
            className="sky-organize-date"
            disabled={organize.busy}
            leftSection={<DayCalendarIcon />}
            onClick={organize.chooseDate}
          >
            Choose date…
          </Button>
        </>
      )}
    </div>
  )
}

export function DayOrganizingFeedback() {
  const organize = useItemOrganizing()
  if (!organize.enabled || (!organize.undo && !organize.error)) return null
  return (
    <div
      className="sky-undo sky-organize-toast"
      data-organizing={organize.active}
      role={organize.error ? 'alert' : 'status'}
    >
      <span className="sky-undo-text">{organize.error ?? organize.undo?.message}</span>
      {organize.undo && (
        <Button variant="secondary" loading={organize.busy} onClick={organize.revert}>
          Undo
        </Button>
      )}
      {organize.error && (
        <Button variant="secondary" disabled={organize.busy} onClick={() => void organize.refresh()}>
          Refresh
        </Button>
      )}
      {organize.undo?.date && !organize.error && (
        <Button variant="secondary" disabled={organize.busy} onClick={organize.openDate}>
          Open date
        </Button>
      )}
      <Button
        variant="secondary"
        aria-label="Dismiss notification"
        disabled={organize.busy}
        onClick={organize.dismissUndo}
      >
        ×
      </Button>
    </div>
  )
}

export function DayItemGrip({ item, disabled }: { item: DayItem; disabled: boolean }) {
  const organize = useItemOrganizing()
  if (!organize.canReorder(item)) return null
  return (
    <button
      type="button"
      className="sky-item-grip"
      data-sort-grip
      disabled={disabled}
      aria-label={`Reorder ${item.text}`}
      title="Drag to reorder. Use Up and Down arrow keys when focused."
      {...organize.gripHandlers(item)}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          organize.step(item, event.key === 'ArrowUp' ? -1 : 1)
        }
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {[5, 12, 19].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />))}
      </svg>
    </button>
  )
}
