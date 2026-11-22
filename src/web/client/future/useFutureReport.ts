import { useCallback, useEffect, useRef, useState } from 'react'
import type { FutureReport } from '../../../service/handler/future/types.ts'
import { futureRequest } from './request.ts'

/** The area's data, read again every few seconds and whenever the tab comes back into view. */
export function useFutureReport() {
  const [report, setReport] = useState<FutureReport | null>(null)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const refresh = useCallback(async () => {
    const at = ++sequence.current
    try {
      const next = await futureRequest<FutureReport>('/report')
      if (at !== sequence.current) return
      // An unchanged report keeps the page's elements, and with them any text the person has selected.
      setReport((current) => (current && JSON.stringify(current) === JSON.stringify(next) ? current : next))
      setError('')
    } catch (problem) {
      if (at === sequence.current) setError((problem as Error).message)
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (!document.hidden) void refresh()
    }, 15_000)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    return () => {
      sequence.current++
      clearInterval(timer)
      window.removeEventListener('focus', focus)
    }
  }, [refresh])
  return { report, error, refresh }
}
