import { useCallback, useEffect, useRef, useState } from 'react'
import type { WizardSession } from '#lib/decisionWizard/session.ts'
import { futureRequest } from '../request.ts'

/** One run of the decision wizard, read again while Sky is thinking so the page follows it. */
export function useRun(id: string) {
  const [run, setRun] = useState<WizardSession | null>(null)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const refresh = useCallback(async () => {
    const at = ++sequence.current
    try {
      const next = await futureRequest<WizardSession>(`/decisions/wizard/${id}`)
      if (at !== sequence.current) return
      setRun(next)
      setError('')
    } catch (problem) {
      if (at === sequence.current) setError((problem as Error).message)
    }
  }, [id])
  useEffect(() => {
    setRun(null)
    void refresh()
  }, [refresh])
  const waiting = run?.status === 'thinking' || Boolean(run?.adding && !run.adding.error)
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => void refresh(), 2000)
    return () => clearInterval(timer)
  }, [waiting, refresh])
  /** A change made on the server; the run it answers with replaces what the page holds. */
  const act = useCallback(
    async (url: string, body: unknown = {}) => {
      sequence.current++
      const next = await futureRequest<WizardSession>(`/decisions/wizard/${id}${url}`, body)
      setRun(next)
      return next
    },
    [id],
  )
  return { run, error, refresh, act }
}
