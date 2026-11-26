/** What a screen lock gives back: released by the caller, or by the browser when the page is hidden. */
interface ScreenLock {
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}

/** The parts of the browser this reads; a test supplies its own. */
export interface ScreenAwakeHost {
  /** Absent in a browser without screen wake locks */
  request?: () => Promise<ScreenLock>
  visible(): boolean
  onVisibilityChange(listener: () => void): () => void
}

const browser = (): ScreenAwakeHost => ({
  request: navigator.wakeLock ? () => navigator.wakeLock.request('screen') : undefined,
  visible: () => document.visibilityState === 'visible',
  onVisibilityChange: (listener) => {
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  },
})

/**
 * Keeps the screen on until the returned function is called. A phone that locks its screen stops the
 * page and the call with it. The browser lets go of the lock whenever the page is hidden, so it is
 * taken again each time the page comes back. A refusal (Low Power Mode, a browser without it) is
 * not a failure of the call.
 */
export function keepScreenAwake(host: ScreenAwakeHost = browser()): () => void {
  let stopped = false
  let held: ScreenLock | null = null
  let asking = false
  const take = async () => {
    if (stopped || held || asking || !host.request || !host.visible()) return
    asking = true
    try {
      const lock = await host.request()
      if (stopped) {
        void lock.release().catch(() => {})
        return
      }
      held = lock
      lock.addEventListener('release', () => {
        if (held === lock) held = null
      })
    } catch {
      // The call goes on with the phone's own lock timer.
    } finally {
      asking = false
    }
  }
  const unlisten = host.onVisibilityChange(() => void take())
  void take()
  return () => {
    stopped = true
    unlisten()
    void held?.release().catch(() => {})
    held = null
  }
}
