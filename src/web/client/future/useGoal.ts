import { useCallback, useEffect, useRef, useState } from 'react'
import type { FutureGoalView } from '../../../service/handler/future/types.ts'
import { futureRequest } from './request.ts'

/**
 * One goal's page, for a goal that is not among the active ones: a goal that
 * ended is read when its page opens, not on every refresh of the area.
 * A null name reads nothing.
 */
export function useGoal(name: string | null) {
  const [view, setView] = useState<FutureGoalView | null>(null)
  const [missing, setMissing] = useState('')
  const sequence = useRef(0)
  const refresh = useCallback(async () => {
    const at = ++sequence.current
    if (name === null) return
    try {
      const next = await futureRequest<FutureGoalView>(`/goals/${encodeURIComponent(name)}`)
      if (at !== sequence.current) return
      setView(next)
      setMissing('')
    } catch (problem) {
      if (at !== sequence.current) return
      setView(null)
      setMissing((problem as Error).message)
    }
  }, [name])
  useEffect(() => {
    setView(null)
    setMissing('')
    void refresh()
    return () => {
      sequence.current++
    }
  }, [refresh])
  return { view, missing, refresh }
}
