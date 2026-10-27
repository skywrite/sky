import * as path from 'node:path'
import { isAIChatPath, parseDateFromDayPath } from '#shared/nbfs/mod.ts'
import { serviceInstance } from './viewVersion.ts'

export type NotebookChange =
  | { type: 'ready'; instance: string }
  | {
      type: 'changed'
      /** Notebook-relative paths; null means a large batch needs a full refresh. */
      paths: string[] | null
      /** Null includes shared sources (profiles, workstreams, and chats spanning days). */
      days: string[] | null
    }

const MAX_PATHS = 256

/** One service-wide batch after ingestion, with a trailing debounce and a bounded wait. */
export class NotebookChanges {
  private listeners = new Set<(change: NotebookChange) => void>()
  private paths = new Set<string>()
  private days = new Set<string>()
  private allDays = false
  private overflow = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null

  constructor(
    private baseDir: string,
    private timeDir: string,
    private delay = 150,
    private maxWait = 1000,
  ) {}

  subscribe(listener: (change: NotebookChange) => void): () => void {
    this.listeners.add(listener)
    // Register first, then ask the client to read: no gap between reading and subscribing.
    listener({ type: 'ready', instance: serviceInstance })
    return () => this.listeners.delete(listener)
  }

  changed(file: string): void {
    const relative = path.relative(this.baseDir, file)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return
    if (!this.overflow) {
      this.paths.add(relative.split(path.sep).join('/'))
      if (this.paths.size > MAX_PATHS) {
        this.paths.clear()
        this.days.clear()
        this.overflow = true
        this.allDays = true
      }
    }
    if (!this.allDays) {
      const timePath = path.relative(this.timeDir, file)
      try {
        if (timePath.startsWith(`..${path.sep}`) || path.isAbsolute(timePath) || isAIChatPath(file)) {
          this.allDays = true
        } else {
          this.days.add(parseDateFromDayPath(path.join('time', timePath)).ymd)
        }
      } catch {
        // Week plans and other shared time files cannot be assigned to just one day.
        this.allDays = true
      }
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delay)
    this.deadline ??= setTimeout(() => this.flush(), this.maxWait)
  }

  private flush(): void {
    const change: NotebookChange = {
      type: 'changed',
      paths: this.overflow ? null : [...this.paths],
      days: this.allDays ? null : [...this.days],
    }
    this.clearBatch()
    for (const listener of this.listeners) listener(change)
  }

  private clearBatch(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.deadline) clearTimeout(this.deadline)
    this.timer = null
    this.deadline = null
    this.paths.clear()
    this.days.clear()
    this.allDays = false
    this.overflow = false
  }

  close(): void {
    this.clearBatch()
    this.listeners.clear()
  }
}
