import * as path from 'node:path'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'

interface IdleState {
  lastInput?: number
  armed?: boolean
  pending?: string
  offered: string[]
}

/** Someone came back after the configured hours away: how long it was, and the day offered for review, if any. */
export interface IdleReturn {
  awayMs: number
  offered: string | null
}

/** A wake and the key that caused it are stamped within a moment of each other; input that close is not counted. */
const WAKE_SLACK_MS = 2000

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

  /**
   * `now` is read before `idleMs`; `wokeAt` is when the computer last woke, background wakes included.
   * The idle timer does not count time asleep, and a closed Mac wakes itself every few minutes, so the
   * timer names a moment someone touched the keys only when it is younger than the last wake. Until then the
   * last input stands and the time asleep counts as time away. Without `wokeAt` the computer never slept.
   */
  async sample(
    now: number,
    idleMs: number | null,
    notebookDay: string | null,
    today: string,
    hours: number,
    wokeAt: number | null = Number.NEGATIVE_INFINITY,
  ): Promise<IdleReturn | undefined> {
    this.supported = idleMs !== null && wokeAt !== null
    if (hours === 0) {
      await this.update((state) => {
        delete state.pending
        state.armed = false
        delete state.lastInput
      })
      this.primed = false
      return
    }
    if (idleMs === null || idleMs < 0 || wokeAt === null) return
    return this.update((state) => {
      const threshold = hours * 3_600_000
      let back: IdleReturn | undefined
      if (idleMs < now - wokeAt - WAKE_SLACK_MS) {
        const input = now - idleMs
        const returned = state.lastInput !== undefined && input > state.lastInput + 1000
        // Across a restart, only a previously observed idle period is evidence.
        // In a live process, a sampling gap can be the computer itself sleeping.
        const gap = state.lastInput === undefined ? 0 : input - state.lastInput
        if (hours > 0 && returned && gap >= threshold && (state.armed || this.primed)) {
          const offered =
            notebookDay && notebookDay < today && !state.offered.includes(notebookDay) ? notebookDay : null
          if (offered) state.pending = offered
          back = { awayMs: gap, offered }
        }
        state.lastInput = input
      }
      state.armed = hours > 0 && state.lastInput !== undefined && now - state.lastInput >= threshold
      this.primed = true
      return back
    })
  }

  async status() {
    const state = await readJson<IdleState>(path.join(this.dir, 'idle.json'))
    return { pending: state?.pending ?? null, supported: this.supported }
  }

  /** The day stays pending, shown in every tab, until a person acts on it in one of them. */
  async acknowledge(day: string) {
    await this.update((state) => {
      state.offered = [...new Set([...state.offered, day])].slice(-366)
      if (state.pending === day) delete state.pending
    })
  }
}
