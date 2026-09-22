import './dayOrganizing.css'
import { Button, NativeSelect } from '@mantine/core'
import {
  createContext,
  type PointerEvent as ReactPointerEvent,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dayItemKey, type CommitmentOrder } from '../../day/organizingTypes.ts'
import type { DayData, DayItem } from './day.tsx'
import { DayCalendarIcon, DayDatePicker } from './dayDatePicker.tsx'
import { useItemEditing } from './dayItemEditing.tsx'

type Result = { view: DayData; undo: string; message: string; date?: string; href?: string }
/** A place the lifted row can land: how far its slot sits from home, and the rows that make room. */
type Landing = {
  offset: number
  threshold: number
  neighbor: string | null
  after: boolean
  first: number
  last: number
  by: number
}
type Drag = {
  item: DayItem
  x: number
  y: number
  startX: number
  startY: number
  active: boolean
  scroll: HTMLElement | null
  /** The list's scroll position when the row lifted; the landings are measured against it. */
  scrolled: number
  /** Every row of the card, top to bottom, as it stood when the row lifted. */
  rows: string[]
  from: number
  landings: Landing[]
  landing: Landing
}
/** The row in hand, and how far each row of its card stands from home while it is out. */
type Sorting = { key: string; shifts: Map<string, number> }
const HOME: Landing = { offset: 0, threshold: 0, neighbor: null, after: false, first: 0, last: -1, by: 0 }
const LANDING_MS = 180
const allItems = (day: DayData | null) =>
  day ? [...day.record.mostImportant, ...day.record.commitments, ...day.record.todos, ...day.record.reminders] : []
const canMove = (item: DayItem) => Boolean(item.revision && !item.workstream)

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
  const [sorting, setSorting] = useState<Sorting | null>(null)
  const drag = useRef<Drag | null>(null)
  /** The copy of the row that travels with the pointer. It outlives the drag until the row has landed. */
  const lift = useRef<HTMLElement | null>(null)
  const landed = useRef<Promise<void>>(Promise.resolve())
  const frame = useRef(0)
  const requestId = useRef<{ payload: string; id: string } | null>(null)
  const focusAfterSave = useRef<string | null>(null)
  const items = allItems(day)
  const endDrag = () => {
    drag.current = null
    cancelAnimationFrame(frame.current)
    delete document.documentElement.dataset.skySorting
  }
  const cancelDrag = () => {
    endDrag()
    lift.current?.remove()
    lift.current = null
    setSorting(null)
  }
  // The copy leaves in the same paint that puts the row back, so the row is never seen twice or not at all.
  useLayoutEffect(() => {
    if (sorting) return
    lift.current?.remove()
    lift.current = null
  }, [sorting])
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
      endDrag()
      lift.current?.remove()
      lift.current = null
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
    // A dropped row finishes landing before the saved list takes its place.
    await landed.current
    if (current.current !== scope) throw new Error('The selected day changed.')
    if (!response.ok) {
      if (body.view) {
        applyView(body.view)
        setSorting(null)
      }
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
      setSorting(null)
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
  /** `keys`: the arrow keys moved the row, so its grip keeps the focus; a dropped row shows no focus ring. */
  const reorder = (item: DayItem, neighbor: DayItem, after: boolean, keys = false) => {
    if (item.list !== neighbor.list || dayItemKey(item) === dayItemKey(neighbor)) return
    const rows = items.filter((row) => row.list === item.list)
    const ordered = rows.filter((row) => dayItemKey(row) !== dayItemKey(item))
    ordered.splice(ordered.findIndex((row) => dayItemKey(row) === dayItemKey(neighbor)) + (after ? 1 : 0), 0, item)
    if (ordered.every((row, index) => dayItemKey(row) === dayItemKey(rows[index]))) return
    focusAfterSave.current = keys ? dayItemKey(item) : null
    return save('reorder', { list: item.list, items: ordered.map(address) })
  }
  const canReorder = (item: DayItem) =>
    enabled &&
    !busy &&
    Boolean(item.revision) &&
    (!/commitments$/i.test(item.list) || day?.record.commitmentsOrder === 'manual')
  const shifts = (state: Drag) =>
    new Map(
      state.rows.map((key, index) => [
        key,
        index === state.from
          ? state.landing.offset
          : index >= state.landing.first && index <= state.landing.last
            ? state.landing.by
            : 0,
      ]),
    )
  /**
   * Lifts the row: a copy of the whole row, text and all, goes under the pointer, and the row
   * itself stays behind as the slot. The landings are measured once, from the list at rest, so
   * rows sliding out of the way never move the ground the pointer is read against.
   */
  const raise = (state: Drag, grip: HTMLElement) => {
    const row = grip.closest<HTMLElement>('[data-organize-key]')
    if (!row?.parentElement) return false
    const nodes = [...row.parentElement.querySelectorAll<HTMLElement>(':scope > [data-organize-key]')]
    const boxes = nodes.map((node) => node.getBoundingClientRect())
    const from = nodes.indexOf(row)
    const home = boxes[from]
    // Taking the row out closes the list by its height and the gap to the row beside it.
    const pitch =
      from + 1 < nodes.length && row.nextElementSibling === nodes[from + 1]
        ? boxes[from + 1].top - home.top
        : from > 0 && row.previousElementSibling === nodes[from - 1]
          ? home.bottom - boxes[from - 1].bottom
          : home.height
    state.rows = nodes.map((node) => node.dataset.organizeKey!)
    state.from = from
    state.scrolled = state.scroll?.scrollTop ?? 0
    state.landings = [HOME]
    nodes.forEach((node, index) => {
      if (index === from || node.dataset.organizeList !== state.item.list) return
      const threshold = boxes[index].top + boxes[index].height / 2 - state.startY
      state.landings.push(
        index < from
          ? {
              offset: boxes[index].top - home.top,
              threshold,
              neighbor: state.rows[index],
              after: false,
              first: index,
              last: from - 1,
              by: pitch,
            }
          : {
              offset: boxes[index].bottom - home.bottom,
              threshold,
              neighbor: state.rows[index],
              after: true,
              first: from + 1,
              last: index,
              by: -pitch,
            },
      )
    })
    // A bare row gets a margin of paper around it; an Organize row already carries its own.
    const halo = parseFloat(getComputedStyle(row).paddingLeft) ? { x: 0, y: 0 } : { x: 10, y: 2 }
    const copy = row.cloneNode(true) as HTMLElement
    copy.removeAttribute('data-organize-key')
    copy.removeAttribute('data-organize-list')
    for (const node of copy.querySelectorAll('[id]')) node.removeAttribute('id')
    const held = document.createElement('div')
    held.className = 'sky-sort-lift'
    held.inert = true
    held.setAttribute('aria-hidden', 'true')
    held.style.left = `${home.left - halo.x}px`
    held.style.top = `${home.top - halo.y}px`
    held.style.width = `${home.width + halo.x * 2}px`
    held.style.padding = `${halo.y}px ${halo.x}px`
    held.style.transformOrigin = `${state.startX - home.left + halo.x}px ${state.startY - home.top + halo.y}px`
    // The copy is cut from the paper the row lay on, a card's tint or the page, so it lands without a seam.
    for (let node: HTMLElement | null = row.parentElement; node; node = node.parentElement) {
      const paper = getComputedStyle(node).backgroundColor
      if (paper === 'rgba(0, 0, 0, 0)') continue
      held.style.backgroundImage = `linear-gradient(${paper}, ${paper})`
      break
    }
    held.append(copy)
    document.body.append(held)
    // The copy paints once where the row lies, so the lift is seen leaving the page.
    held.getBoundingClientRect()
    held.dataset.held = 'true'
    lift.current = held
    document.documentElement.dataset.skySorting = 'true'
    return true
  }
  /** Keeps the copy under the pointer and opens the slot nearest to it. */
  const follow = () => {
    const state = drag.current
    if (!state?.active || !lift.current) return
    lift.current.style.translate = `0 ${state.y - state.startY}px`
    const travel = state.y - state.startY + (state.scroll?.scrollTop ?? 0) - state.scrolled
    // A tall row's final offset differs from the pointer's travel. Cross the
    // siblings' original midpoints so notes cannot make a drag skip a row.
    const landing = state.landings.reduce((best, next) => {
      if (next.after && travel >= next.threshold && next.offset > best.offset) return next
      if (!next.after && travel <= next.threshold && next.offset < best.offset) return next
      return best
    }, HOME)
    if (landing === state.landing) return
    state.landing = landing
    setSorting({ key: dayItemKey(state.item), shifts: shifts(state) })
  }
  const scrollDrag = () => {
    const state = drag.current
    if (!state?.active) return
    if (state.scroll) {
      const bounds = state.scroll.getBoundingClientRect()
      // A row picked up beside an edge stays put until the pointer heads for that edge.
      const speed =
        state.y < bounds.top + 48 && state.y < state.startY
          ? -10
          : state.y > bounds.bottom - 48 && state.y > state.startY
            ? 10
            : 0
      if (speed) {
        state.scroll.scrollTop += speed
        follow()
      }
    }
    frame.current = requestAnimationFrame(scrollDrag)
  }
  /** Lets go: the copy glides into its slot, or home when the drag is called off, and then the list is saved. */
  const release = (keep: boolean) => {
    const state = drag.current
    endDrag()
    if (!state?.active) return
    if (!keep && state.landing !== HOME) {
      state.landing = HOME
      setSorting({ key: dayItemKey(state.item), shifts: shifts(state) })
    }
    const held = lift.current
    if (held) {
      held.dataset.held = 'false'
      held.style.translate = `0 ${state.landing.offset - (state.scroll?.scrollTop ?? 0) + state.scrolled}px`
    }
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    landed.current = new Promise((resolve) => setTimeout(resolve, still ? 0 : LANDING_MS))
    const neighbor = items.find((row) => dayItemKey(row) === state.landing.neighbor)
    // A save that never started, or failed, still puts the row back. A newer drag is left alone.
    void Promise.all([landed.current, neighbor && reorder(state.item, neighbor, state.landing.after)]).finally(() => {
      if (lift.current === held) setSorting(null)
    })
  }
  const gripHandlers = (item: DayItem) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      // A row still landing keeps the floor until it is down.
      if (!canReorder(item) || event.button !== 0 || lift.current) return
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
        scroll: event.currentTarget.closest('.sky-scroll'),
        scrolled: 0,
        rows: [],
        from: 0,
        landings: [HOME],
        landing: HOME,
      }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const state = drag.current
      if (!state) return
      state.x = event.clientX
      state.y = event.clientY
      if (!state.active && Math.hypot(state.x - state.startX, state.y - state.startY) > 5) {
        if (!raise(state, event.currentTarget)) return endDrag()
        state.active = true
        setSorting({ key: dayItemKey(item), shifts: shifts(state) })
        frame.current = requestAnimationFrame(scrollDrag)
      }
      if (state.active) follow()
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      release(true)
    },
    onPointerCancel: () => release(false),
    onLostPointerCapture: () => release(false),
  })
  // Escape puts the row back where it was.
  useEffect(() => {
    if (!sorting) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') release(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sorting])
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
    sorting,
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
        date: new PlainDate(day!.planningToday ?? day!.today.ymd).addDays(1).ymd,
      }),
    tomorrowIsCurrent: Boolean(day && ymd === new PlainDate(day.planningToday ?? day.today.ymd).addDays(1).ymd),
    revert: () => void revert(),
    openDate: () => {
      if (undo?.date) navigate(undo.href ?? `/${undo.date}`)
    },
    step: (item: DayItem, direction: -1 | 1) => {
      const nodes = [...document.querySelectorAll<HTMLElement>('[data-organize-key]')].filter(
        (node) => node.dataset.organizeList === item.list,
      )
      const at = nodes.findIndex((node) => node.dataset.organizeKey === dayItemKey(item))
      const key = nodes[at + direction]?.dataset.organizeKey
      const neighbor = items.find((row) => dayItemKey(row) === key)
      if (neighbor) void reorder(item, neighbor, direction === 1, true)
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
          today={day.planningToday ?? day.today.ymd}
          initial={new PlainDate(day.planningToday ?? day.today.ymd).addDays(1).ymd}
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
      <span>
        {organize.eligible.length
          ? 'Select items to move, or drag to reorder.'
          : 'Drag to reorder. Schedule linked activities from their workstream.'}
      </span>
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
