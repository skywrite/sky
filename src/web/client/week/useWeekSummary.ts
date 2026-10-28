import { useEffect, useRef, useState } from 'react'
import type { WeekSummaryView } from '../../../service/handler/week/summary.ts'

export function useWeekSummary(week: string) {
  const [view, setView] = useState<WeekSummaryView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [tick, setTick] = useState(0)
  const requests = useRef<AbortController | null>(null)
  const api = `/week/_api/${week}/summary`

  useEffect(() => {
    const controller = new AbortController()
    requests.current = controller
    let timer: ReturnType<typeof setTimeout>
    let reading = false
    const read = async () => {
      if (reading || controller.signal.aborted) return
      clearTimeout(timer)
      if (document.hidden) {
        timer = setTimeout(() => void read(), 5000)
        return
      }
      reading = true
      let delay = 10_000
      try {
        const response = await fetch(api, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`Could not check the summary for week ${week}. Try refreshing.`)
        const next = (await response.json()) as WeekSummaryView
        if (!controller.signal.aborted) {
          setView(next)
          setReadError(null)
          if (next.running || next.path) setError(null)
          if (next.running) delay = 1500
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setReadError(error instanceof Error ? error.message : 'The service did not answer. Try refreshing.')
      } finally {
        reading = false
        if (!controller.signal.aborted) timer = setTimeout(() => void read(), delay)
      }
    }
    void read()
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', read)
    return () => {
      controller.abort()
      clearTimeout(timer)
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', read)
    }
  }, [api, week, tick])

  const generate = async (allowMissing: boolean) => {
    const controller = requests.current
    if (!controller || submitting || view?.running) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allowMissing }),
        signal: controller.signal,
      })
      const body = (await response.json()) as WeekSummaryView | { error: string }
      if (!response.ok || !('week' in body))
        throw new Error(body.error ?? `Could not start the summary for week ${week}. Try again.`)
      if (!controller.signal.aborted) {
        setView(body)
        setTick((value) => value + 1)
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'The service did not answer. Try again.')
    } finally {
      if (!controller.signal.aborted) setSubmitting(false)
    }
  }

  return { view, error: readError ?? error, submitting, generate, refresh: () => setTick((value) => value + 1) }
}
