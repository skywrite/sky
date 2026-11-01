import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecurringReport } from '../../../service/handler/recurring/types.ts'
import { recurringApi } from './api.ts'

export function useRecurring(editing: boolean) {
  const [report, setReport] = useState<RecurringReport | null>(null)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const current = ++sequence.current
    try {
      const next = await recurringApi<RecurringReport>()
      if (current === sequence.current) {
        setReport(next)
        setError('')
      }
    } catch (problem) {
      if (current === sequence.current) setError((problem as Error).message)
    }
  }, [])
  useEffect(() => {
    void reload()
    return () => {
      sequence.current++
    }
  }, [reload])
  useEffect(() => {
    if (editing) return
    const refresh = () => {
      if (!document.hidden) void reload()
    }
    window.addEventListener('focus', refresh)
    const timer = setInterval(refresh, 30_000)
    return () => {
      window.removeEventListener('focus', refresh)
      clearInterval(timer)
    }
  }, [editing, reload])
  const accept = (next: RecurringReport) => {
    sequence.current++
    setReport(next)
    setError('')
  }
  return { report, error, reload, accept }
}
