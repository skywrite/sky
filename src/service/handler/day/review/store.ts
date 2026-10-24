import * as path from 'node:path'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { hold } from '../../../activity.ts'
import {
  RECAPS,
  type RecapId,
  type ReviewItem,
  type ReviewRuntime,
  type ReviewState,
  type ReviewView,
} from './types.ts'

export interface ReviewInventory {
  today: string
  items: ReviewItem[]
  hasDay: boolean
  ended: boolean
  summaryHref: string | null
}
export interface ReviewHost {
  inventory(day: string): Promise<ReviewInventory>
  apply(day: string, item: ReviewItem, values?: Record<string, string>): Promise<void>
  move?(day: string, items: ReviewItem[], today: string): Promise<void>
  runtime: ReviewRuntime
}

/** The date is the natural key: one resumable review of one notebook day. */
export class DayReviewStore {
  private readonly workers = new Map<string, Promise<void>>()
  private readonly requested = new Set<string>()
  constructor(
    private readonly dir: string,
    private readonly host: ReviewHost,
  ) {}

  private file(day: string) {
    return path.join(this.dir, `${day}.json`)
  }
  private async read(day: string): Promise<ReviewState> {
    return (
      (await readJson<ReviewState>(this.file(day))) ?? {
        day,
        paused: true,
        answers: {},
        drafts: {},
        recaps: RECAPS.map((job) => ({ ...job, status: 'waiting' })),
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
    const [state, inventory] = await Promise.all([this.read(day), this.host.inventory(day)])
    return {
      ...state,
      ...inventory,
      items: inventory.items.filter((item) => !state.answers[item.id]),
      summary: inventory.summaryHref ? { ...state.summary, status: 'done' } : state.summary,
    }
  }
  async refresh(day: string) {
    const view = await this.view(day)
    if (view.hasDay && !view.paused && !view.items.length && view.summary.status === 'waiting') this.kick(day)
    return view
  }
  async open(day: string) {
    const inventory = await this.host.inventory(day)
    if (day >= inventory.today) throw new Error('Review a previous day. Today is still in progress.')
    await this.host.runtime.acknowledge(day)
    await this.change(day, (state) => {
      state.paused = false
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
  async draft(day: string, id: string, values: Record<string, string>) {
    await this.change(day, (state) => {
      state.drafts[id] = values
    })
  }
  async move(day: string, ids: string[]) {
    await this.change(day, async (state) => {
      const pending = ids.filter((id) => !state.answers[id])
      if (!pending.length) return
      const inventory = await this.host.inventory(day)
      const items = pending.map((id) => inventory.items.find((item) => item.id === id))
      if (items.some((item) => !item || item.kind !== 'carry'))
        throw new Error('The selected tasks changed. Refresh the review before moving them.')
      const selected = items as ReviewItem[]
      const blocked = selected.filter((item) => item.blocked)
      if (blocked.length) throw new Error(blocked.map((item) => `${item.title}: ${item.blocked}`).join('\n'))
      if (!this.host.move) throw new Error('Moving tasks is unavailable.')
      await this.host.move(day, selected, inventory.today)
      for (const item of selected) state.answers[item.id] = { item, result: 'moved', target: inventory.today }
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
      state.answers[id] = {
        item,
        result: action === 'skip' ? 'skipped' : item.kind === 'carry' ? 'moved' : 'done',
        ...(action === 'apply' && item.kind === 'carry' ? { target: inventory.today } : {}),
      }
      delete state.drafts[id]
    })
    this.kick(day)
    return this.view(day)
  }
  async retry(day: string, id: string) {
    await this.change(day, (state) => {
      const job = [...state.recaps, state.summary].find((job) => job.id === id)
      if (!job || job.status !== 'error') throw new Error('Only a failed job can be retried.')
      job.status = 'waiting'
      delete job.message
    })
    this.kick(day)
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
    for (const recap of view.recaps) {
      if (recap.status !== 'waiting') continue
      await this.change(day, (state) => {
        state.recaps.find((job) => job.id === recap.id)!.status = 'running'
      })
      try {
        const message = await this.host.runtime.recap(recap.id as RecapId, day)
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
    }
    // Re-read after every recap and every user action. Closing does not authorize a summary.
    view = await this.view(day)
    if (
      view.paused ||
      view.items.length ||
      view.recaps.some((job) => job.status !== 'done') ||
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
    try {
      await this.host.runtime.summarize(day)
      await this.change(day, (state) => {
        state.summary.status = 'done'
        delete state.summary.message
      })
    } catch (error) {
      await this.change(day, (state) => {
        state.summary.status = 'error'
        state.summary.message = (error as Error).message
      })
    }
  }
}
