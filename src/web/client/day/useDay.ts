import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { subscribeNotebookChanges } from '../lib/notebookChanges.ts'
import { DayState } from './dayState.ts'

/** Initial reads, saves and watcher refreshes all land in one date-scoped snapshot. */
export function useDay(ymd: string | null, refreshKey?: string) {
  const state = useMemo(() => new DayState(ymd), [ymd])
  const day = useSyncExternalStore(state.subscribe, state.snapshot)
  useEffect(() => {
    state.start()
    const off = subscribeNotebookChanges(state.notice)
    return () => {
      off()
      state.stop()
    }
  }, [state])
  useEffect(() => state.refresh(), [state, refreshKey])
  return { day, applyView: state.applyView }
}
