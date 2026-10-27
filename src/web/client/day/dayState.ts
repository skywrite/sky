import type { NotebookNotice } from '../lib/notebookChanges.ts'
import type { DayData } from './day.tsx'

type ReadDay = (signal: AbortSignal) => Promise<DayData>

/** The single saved snapshot for the shell and day page, independent of their local drafts. */
export class DayState {
  private value: DayData | null = null
  private listeners = new Set<() => void>()
  private instance: string | null = null
  private controller: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending = false
  private active = false
  private retryDelay = 1000
  private retrying = false

  constructor(
    private ymd: string | null,
    private read: ReadDay = async (signal) => {
      const response = await fetch(ymd ? `/day/${ymd}` : '/day', { signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`Could not read the day (${response.status}).`)
      return response.json() as Promise<DayData>
    },
    private delay = 150,
  ) {}

  snapshot = (): DayData | null => this.value
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    this.active = true
    this.refresh(true)
  }

  stop(): void {
    this.active = false
    this.controller?.abort()
    this.controller = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = false
  }

  notice = (change: NotebookNotice): void => {
    if (change.type === 'ready') {
      if (this.instance !== change.instance) {
        this.instance = change.instance
        this.controller?.abort()
      }
      this.refresh()
    } else if (change.type === 'resume') {
      this.refresh()
    } else {
      const day = this.ymd ?? this.value?.day.ymd
      if (
        change.days === null ||
        !day ||
        change.days.includes(day) ||
        // A new day file can move the notebook's Today pointer.
        (!this.ymd && change.paths?.some((file) => file.endsWith('/day.md')))
      )
        this.refresh()
    }
  }

  /** At most one read runs; changes during it request one trailing read. */
  refresh = (immediate = false): void => {
    if (!this.active) return
    this.pending = true
    if (this.retrying && this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.controller || this.timer) return
    this.schedule(immediate ? 0 : this.delay)
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = null
      this.retrying = false
      void this.load()
    }, delay)
  }

  private async load(): Promise<void> {
    if (!this.active) return
    this.pending = false
    const controller = new AbortController()
    this.controller = controller
    let failed = false
    try {
      const view = await this.read(controller.signal)
      if (!controller.signal.aborted && this.active) this.accept(view)
      this.retryDelay = 1000
    } catch {
      failed = !controller.signal.aborted
      // A failed background read leaves the last saved view and drafts on screen.
    } finally {
      if (this.controller === controller) {
        this.controller = null
        if (this.active && (this.pending || failed)) {
          this.retrying = !this.pending && failed
          this.schedule(this.pending ? this.delay : this.retryDelay)
          if (failed) this.retryDelay = Math.min(this.retryDelay * 2, 30000)
        }
      }
    }
  }

  /** Mutation replies use the same ordered snapshot as background reads. */
  applyView = (view: DayData): void => {
    const day = this.ymd ?? this.value?.day.ymd
    if (day && day !== view.day.ymd) return
    this.accept(view)
  }

  private accept(view: DayData): void {
    if (!this.active || (this.ymd && view.day.ymd !== this.ymd)) return
    const previous = this.value?.version
    if (view.version) {
      if (this.instance && view.version.instance !== this.instance) return
      if (previous?.instance === view.version.instance && previous.sequence >= view.version.sequence) return
    } else if (previous) return
    this.value = view
    for (const listener of this.listeners) listener()
  }
}
