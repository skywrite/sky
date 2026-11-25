import { useCallback, useEffect, useRef, useState } from 'react'
import type { FutureDecisionView } from '../../../service/handler/future/types.ts'
import { futureRequest } from './request.ts'

/** One decision's page, read when it opens and again whenever the tab comes back into view. */
export function useDecision(name: string) {
  const [view, setView] = useState<FutureDecisionView | null>(null)
  const [missing, setMissing] = useState('')
  const sequence = useRef(0)
  const refresh = useCallback(async () => {
    const at = ++sequence.current
    try {
      const next = await futureRequest<FutureDecisionView>(`/decision/${encodeURIComponent(name)}`)
      if (at !== sequence.current) return
      // An unchanged page keeps its elements, and with them any text the person has selected.
      setView((current) => (current && JSON.stringify(current) === JSON.stringify(next) ? current : next))
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
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    return () => {
      sequence.current++
      window.removeEventListener('focus', focus)
    }
  }, [refresh])
  return { view, missing, refresh }
}
