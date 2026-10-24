import * as path from 'node:path'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'

interface IdleState {
  lastInput?: number
  armed?: boolean
  pending?: string
  offered: string[]
}

/** OS input, rather than browser polling, is the evidence that someone returned. */
export class ReviewIdle {
  private primed = false
  private supported = false
  constructor(private readonly dir: string) {}

  private async update<T>(run: (state: IdleState) => T): Promise<T> {
    return withProcessLock(path.join(this.dir, 'idle.lock'), async () => {
      const file = path.join(this.dir, 'idle.json')
      const state = (await readJson<IdleState>(file)) ?? { offered: [] }
      const result = run(state)
      await writeJson(file, state)
      return result
    })
  }

  async sample(now: number, idleMs: number | null, notebookDay: string | null, today: string, hours: number) {
    this.supported = idleMs !== null
    if (hours === 0) {
      await this.update((state) => {
        delete state.pending
        state.armed = false
        delete state.lastInput
      })
      this.primed = false
      return
    }
    if (idleMs === null || idleMs < 0) return
    await this.update((state) => {
      const threshold = hours * 3_600_000
      const input = now - idleMs
      const returned = state.lastInput !== undefined && input > state.lastInput + 1000
      // Across a restart, only a previously observed idle period is evidence.
      // In a live process, a sampling gap can be the computer itself sleeping.
      const gap = state.lastInput === undefined ? 0 : input - state.lastInput
      if (hours > 0 && returned && gap >= threshold && (state.armed || this.primed)) {
        if (notebookDay && notebookDay < today && !state.offered.includes(notebookDay)) state.pending = notebookDay
      }
      state.armed = hours > 0 && idleMs >= threshold
      state.lastInput = input
      this.primed = true
    })
  }

  async status() {
    const state = await readJson<IdleState>(path.join(this.dir, 'idle.json'))
    return { pending: state?.pending ?? null, supported: this.supported }
  }

  async claim() {
    return this.update((state) => {
      const day = state.pending ?? null
      if (day) state.offered = [...new Set([...state.offered, day])].slice(-366)
      delete state.pending
      return day
    })
  }

  async acknowledge(day: string) {
    await this.update((state) => {
      state.offered = [...new Set([...state.offered, day])].slice(-366)
      if (state.pending === day) delete state.pending
    })
  }
}
