import * as path from 'node:path'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { hold } from '../../../activity.ts'
import {
  isReminder,
  REVIEW_STEPS,
  reviewItemStep,
  type ReviewItem,
  type ReviewChat,
  type ReviewJob,
  type ReviewRuntime,
  type ReviewStart,
  type ReviewState,
  type ReviewStep,
  type ReviewView,
} from './types.ts'

export interface ReviewInventory {
  today: string
  items: ReviewItem[]
  hasDay: boolean
  summarized: boolean
  summaryHref: string | null
  chats?: ReviewChat[]
  /** The day waiting to begin, once the calendar has moved past the open day; null when none waits. */
  due?: { ymd: string; weekday: string } | null
}
export interface ReviewHost {
  inventory(day: string): Promise<ReviewInventory>
  apply(day: string, item: ReviewItem, values?: Record<string, string>): Promise<void>
  carry?(day: string, items: ReviewItem[], today: string, how: 'copy' | 'move'): Promise<void>
  /** day:start for the waiting day, as Start runs it; rejects with the reason it did not start. */
  startDay?(ymd: string): Promise<void>
  runtime: ReviewRuntime
}

/** The date is the natural key: one resumable review of one notebook day. */
export class DayReviewStore {
  private readonly workers = new Map<string, Promise<void>>()
  private readonly requested = new Set<string>()
  /** The running summary's Stop, by day. */
  private readonly summaries = new Map<string, AbortController>()
  /** The day each review's return prompt started, by reviewed day; the day file itself records the start. */
  private readonly starts = new Map<string, ReviewStart>()
  constructor(
    private readonly dir: string,
    private readonly host: ReviewHost,
  ) {}

  private file(day: string) {
    return path.join(this.dir, `${day}.json`)
  }
  /** Saved recaps are the runs a person started here; whether a recap exists is its file's to say. */
  private async read(day: string): Promise<ReviewState> {
    return (
      (await readJson<ReviewState>(this.file(day))) ?? {
        day,
        paused: true,
        answers: {},
        drafts: {},
        recaps: [],
        summary: { id: 'summary', title: 'Daily summary', status: 'waiting' },
      }
    )
  }
  private async change<T>(day: string, action: (state: ReviewState) => T | Promise<T>): Promise<T> {
    return withProcessLock(path.join(this.dir, `${day}.lock`), async () => {
      const state = await this.read(day)
      const result = await action(state)
      await writeJson(this.file(day), state, 2)
      return result
    })
  }
  async view(day: string): Promise<ReviewView> {
    const [state, inventory, recaps] = await Promise.all([
      this.read(day),
      this.host.inventory(day),
      this.host.runtime.recaps(day),
    ])
    const missingSummary = !inventory.summaryHref && state.summary.status === 'done'
    const items = inventory.items.filter((item) => !state.answers[item.id])
    const { due: _due, ...shown } = inventory
    return {
      ...state,
      ...shown,
      start: this.starts.get(day) ?? null,
      // A run in progress shows as one; otherwise the file decides, then what the person did here.
      recaps: recaps.map(({ id, title, saved }): ReviewJob => {
        const job = state.recaps.find((job) => job.id === id)
        if (job?.status === 'waiting' || job?.status === 'running') return { ...job, title }
        if (saved) return { id, title, status: 'done' }
        if (job?.status === 'done') return { ...job, title, message: job.message ?? 'Nothing to recap for this day.' }
        if (job?.status === 'error' || job?.status === 'skipped') return { ...job, title }
        return { id, title, status: 'missing' }
      }),
      // Deleting a summary reopens editing; only explicitly reopening review regenerates it.
      paused: missingSummary || state.paused,
      items,
      chats: inventory.chats ?? [],
      step:
        state.step ??
        REVIEW_STEPS.find((step) => items.some((item) => reviewItemStep(item) === step)) ??
        (inventory.chats?.length ? 'chat' : 'summary'),
      summary: inventory.summaryHref
        ? { ...state.summary, status: 'done' }
        : missingSummary
          ? { id: 'summary', title: 'Daily summary', status: 'waiting' }
          : state.summary,
    }
  }
  async refresh(day: string) {
    const view = await this.view(day)
    if (view.hasDay && !view.paused && !view.items.length && view.summary.status === 'waiting') this.kick(day)
    return view
  }
  /** A prompted open is the return prompt showing in a tab; the day stays offered until a person acts. */
  async open(day: string, { prompted = false }: { prompted?: boolean } = {}) {
    const inventory = await this.host.inventory(day)
    if (day >= inventory.today) throw new Error('Review a previous day. Today is still in progress.')
    if (!prompted) await this.host.runtime.acknowledge(day)
    // The prompt shows after hours away across a calendar date: the morning, so the waiting day starts, once.
    else if (!this.starts.has(day)) this.startWaitingDay(day, inventory.due)
    await this.change(day, (state) => {
      state.paused = false
      if (inventory.summaryHref) {
        state.summary.status = 'done'
        delete state.summary.message
      } else if (state.summary.status === 'done') {
        state.summary.status = 'waiting'
        delete state.summary.message
      }
      state.step ??=
        REVIEW_STEPS.find((step) =>
          inventory.items.some((item) => !state.answers[item.id] && reviewItemStep(item) === step),
        ) ?? (inventory.chats?.length ? 'chat' : 'summary')
      if (!this.workers.has(day)) {
        for (const job of [...state.recaps, state.summary]) {
          if (job.status === 'running') {
            job.status = 'error'
            job.message = 'Sky restarted before this finished. Retry to check the saved result and continue.'
          }
        }
      }
    })
    this.kick(day)
    return this.view(day)
  }
  async close(day: string) {
    await this.change(day, (state) => {
      state.paused = true
    })
  }
  /** Try again after the prompt's start failed: whichever day waits now. */
  async startAgain(day: string) {
    const failed = this.starts.get(day)
    if (failed?.status !== 'error') throw new Error('Only a start that failed can be tried again.')
    const { due } = await this.host.inventory(day)
    // Another tab may have tried again meanwhile.
    if (this.starts.get(day) === failed) {
      this.starts.delete(day)
      this.startWaitingDay(day, due)
    }
    return this.view(day)
  }
  /** Runs in the background, as Start would, while the review shows it running, done, or why it failed. */
  private startWaitingDay(day: string, due: ReviewInventory['due']) {
    if (!this.host.startDay || !due) return
    const job: ReviewStart = { ymd: due.ymd, weekday: due.weekday, status: 'running' }
    this.starts.set(day, job)
    const release = hold('starting the day')
    void this.host
      .startDay(due.ymd)
      .then(
        () => this.starts.set(day, { ...job, status: 'done' }),
        (error: unknown) => this.starts.set(day, { ...job, status: 'error', message: (error as Error).message }),
      )
      .finally(release)
  }
  async draft(day: string, id: string, values: Record<string, string>) {
    await this.change(day, (state) => {
      state.drafts[id] = values
    })
  }
  async goToStep(day: string, step: ReviewStep, skipIds: string[] = []) {
    await this.change(day, async (state) => {
      if (skipIds.length) {
        const inventory = await this.host.inventory(day)
        const items = skipIds
          .filter((id) => !state.answers[id])
          .map((id) => inventory.items.find((item) => item.id === id))
        if (items.some((item) => !item))
          throw new Error('Some items changed. Refresh the review before skipping this step.')
        for (const item of items as ReviewItem[]) {
          state.answers[item.id] = { item, result: 'skipped' }
          delete state.drafts[item.id]
        }
      }
      state.step = step
    })
    if (skipIds.length) this.kick(day)
    return this.view(day)
  }
  /** A to-do is copied, so its day keeps it unfinished; a reminder is moved, since it lives on one day at a time. */
  async carry(day: string, ids: string[], how: 'copy' | 'move') {
    await this.change(day, async (state) => {
      const pending = ids.filter((id) => !state.answers[id])
      if (!pending.length) return
      const inventory = await this.host.inventory(day)
      const items = pending.map((id) => inventory.items.find((item) => item.id === id))
      if (items.some((item) => !item || item.kind !== 'carry' || isReminder(item) !== (how === 'move')))
        throw new Error('The selected tasks changed. Refresh the review before bringing them to today.')
      const selected = items as ReviewItem[]
      const blocked = selected.filter((item) => item.blocked)
      if (blocked.length) throw new Error(blocked.map((item) => `${item.title}: ${item.blocked}`).join('\n'))
      if (!this.host.carry) throw new Error('Bringing tasks to today is unavailable.')
      await this.host.carry(day, selected, inventory.today, how)
      const result = how === 'copy' ? 'copied' : 'moved'
      for (const item of selected) state.answers[item.id] = { item, result, target: inventory.today }
    })
    this.kick(day)
    return this.view(day)
  }
  async answer(day: string, id: string, action: 'skip' | 'apply' | 'restore', values?: Record<string, string>) {
    await this.change(day, async (state) => {
      if (action === 'restore') {
        delete state.answers[id]
        return
      }
      if (state.answers[id]) return
      const inventory = await this.host.inventory(day)
      const item = inventory.items.find((item) => item.id === id)
      if (!item) throw new Error('This item changed or was already handled elsewhere. Refresh the review.')
      if (action === 'apply') {
        if (item.blocked) throw new Error(`${item.title}: ${item.blocked}`)
        try {
          await this.host.apply(day, item, values)
        } catch (error) {
          throw new Error(`${item.title}: ${(error as Error).message}`)
        }
      }
      state.answers[id] = { item, result: action === 'skip' ? 'skipped' : 'done' }
      delete state.drafts[id]
    })
    this.kick(day)
    return this.view(day)
  }
  async retry(day: string, id: string) {
    await this.change(day, (state) => {
      const job = [...state.recaps, state.summary].find((job) => job.id === id)
      if (!job || (job.status !== 'error' && job.status !== 'stopped'))
        throw new Error('Only a failed or stopped job can be retried.')
      job.status = 'waiting'
      delete job.message
    })
    this.kick(day)
    return this.view(day)
  }
  /** Starts the listed recaps that are missing, failed or skipped; nothing runs on its own. */
  runRecaps(day: string, ids: string[]) {
    return this.markRecaps(day, ids, 'waiting')
  }
  /** Lets the summary go ahead without the listed missing or failed recaps. */
  skipRecaps(day: string, ids: string[]) {
    return this.markRecaps(day, ids, 'skipped')
  }
  private async markRecaps(day: string, ids: string[], status: 'waiting' | 'skipped') {
    const rows = (await this.view(day)).recaps.filter(
      (job) => ids.includes(job.id) && (job.status === 'missing' || job.status === 'error' || job.status === 'skipped'),
    )
    await this.change(day, (state) => {
      for (const row of rows) {
        const started = state.recaps.find((job) => job.id === row.id)
        // Started in another tab meanwhile: it keeps running.
        if (started?.status === 'waiting' || started?.status === 'running') continue
        state.recaps = [...state.recaps.filter((job) => job.id !== row.id), { id: row.id, title: row.title, status }]
      }
    })
    this.kick(day)
    return this.view(day)
  }
  /** Stop ends the running summary before it writes; it then waits for Start again, through closing and reopening. */
  async stop(day: string, id: string) {
    await this.change(day, (state) => {
      if (id !== state.summary.id) throw new Error('Only the summary can be stopped.')
      if (state.summary.status !== 'running') throw new Error('The summary is not running.')
      state.summary.status = 'stopped'
      state.summary.message = 'Stopped. Nothing was written.'
    })
    this.summaries.get(day)?.abort()
    return this.view(day)
  }
  private kick(day: string) {
    if (this.workers.has(day)) {
      this.requested.add(day)
      return
    }
    const release = hold('reviewing a day')
    const worker = this.run(day)
      .catch(async (error: unknown) => {
        await this.change(day, (state) => {
          state.summary.status = 'error'
          state.summary.message = (error as Error).message
        })
      })
      .finally(() => {
        this.workers.delete(day)
        release()
        if (this.requested.delete(day)) this.kick(day)
      })
    this.workers.set(day, worker)
  }
  async settled(day: string) {
    while (this.workers.has(day)) await this.workers.get(day)
  }

  private async run(day: string) {
    let view = await this.view(day)
    if (!view.hasDay) return
    const recaps = await this.change(day, (state) => {
      const waiting = state.recaps.filter((job) => job.status === 'waiting')
      for (const job of waiting) job.status = 'running'
      return waiting
    })
    await Promise.all(
      recaps.map(async (recap) => {
        try {
          const message = await this.host.runtime.recap(recap.id, day)
          await this.change(day, (state) => {
            Object.assign(
              state.recaps.find((job) => job.id === recap.id)!,
              { status: 'done', message },
            )
          })
        } catch (error) {
          await this.change(day, (state) => {
            Object.assign(
              state.recaps.find((job) => job.id === recap.id)!,
              { status: 'error', message: (error as Error).message },
            )
          })
        }
      }),
    )
    // Re-read after all recaps finish, including any intervening choices or pause.
    // Every recap is ready, ran with nothing to recap, or was skipped by the person before the summary starts.
    view = await this.view(day)
    if (
      view.paused ||
      view.items.length ||
      view.recaps.some((job) => job.status !== 'done' && job.status !== 'skipped') ||
      view.summary.status !== 'waiting'
    )
      return
    const start = await this.change(day, async (state) => {
      if (state.paused || state.summary.status !== 'waiting') return false
      const inventory = await this.host.inventory(day)
      if (inventory.items.some((item) => !state.answers[item.id]) || inventory.summaryHref) return false
      state.summary.status = 'running'
      return true
    })
    if (!start) return
    const abort = new AbortController()
    this.summaries.set(day, abort)
    try {
      await this.host.runtime.summarize(day, abort.signal)
      await this.change(day, (state) => {
        state.summary.status = 'done'
        delete state.summary.message
      })
    } catch (error) {
      // A stopped run's outcome is the stop's; the state already says so.
      if (abort.signal.aborted) return
      await this.change(day, (state) => {
        state.summary.status = 'error'
        state.summary.message = (error as Error).message
      })
    } finally {
      this.summaries.delete(day)
    }
  }
}
