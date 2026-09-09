import { useCallback, useEffect, useRef, useState } from 'react'
import type { StreakMutation, StreakReport } from '../../streaks/types.ts'

async function request<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/streaks/_api${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? `Streaks could not complete this step (${response.status}).`)
  return body as T
}

export function useStreaksReport(refreshKey?: unknown) {
  const [report, setReport] = useState<StreakReport | null>(null)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++sequence.current
    try {
      const next = await request<StreakReport>('/report')
      if (current !== sequence.current) return
      setReport(next)
      setError('')
    } catch (problem) {
      if (current === sequence.current) setError((problem as Error).message)
    }
  }, [])
  useEffect(() => {
    void refresh()
    const update = () => {
      if (!document.hidden) void refresh()
    }
    const timer = setInterval(update, 15_000)
    window.addEventListener('focus', update)
    window.addEventListener('sky-streaks-changed', update)
    return () => {
      sequence.current++
      clearInterval(timer)
      window.removeEventListener('focus', update)
      window.removeEventListener('sky-streaks-changed', update)
    }
  }, [refresh, refreshKey])
  return { report, error, refresh }
}

export function useStreaksActions(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<StreakMutation | null>(null)
  const writing = useRef(false)
  useEffect(() => {
    if (!notice || busy) return
    const timer = setTimeout(() => setNotice(null), 12_000)
    return () => clearTimeout(timer)
  }, [notice, busy])
  const act = async (path: string, body: unknown): Promise<StreakMutation | null> => {
    if (writing.current) return null
    writing.current = true
    setBusy(true)
    setError('')
    try {
      const result = await request<StreakMutation>(path, body)
      setNotice(path === '/undo' ? null : result)
      await refresh()
      window.dispatchEvent(new Event('sky-streaks-changed'))
      return result
    } catch (problem) {
      setError((problem as Error).message)
      await refresh()
      return null
    } finally {
      writing.current = false
      setBusy(false)
    }
  }
  return { busy, error, setError, notice, setNotice, act }
}
export type StreaksActions = ReturnType<typeof useStreaksActions>
