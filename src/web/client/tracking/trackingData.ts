import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrackingMutation, TrackingReport } from '#lib/tracking/types.ts'

export async function trackingRequest<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetch(`/tracking/_api${url}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? `Tracking could not complete this step (${response.status}).`)
  return body as T
}

export function useTrackingReport(query: string) {
  const [report, setReport] = useState<TrackingReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const sequence = useRef(0)
  const current = useRef(query)
  current.current = query
  const refresh = useCallback(async () => {
    const at = ++sequence.current
    try {
      const next = await trackingRequest<TrackingReport>(`/report${query ? `?${query}` : ''}`)
      if (at !== sequence.current || current.current !== query) return
      setReport(next)
      setError('')
    } catch (problem) {
      if (at === sequence.current && current.current === query) setError((problem as Error).message)
    } finally {
      if (at === sequence.current && current.current === query) setLoading(false)
    }
  }, [query])
  useEffect(() => {
    setLoading(true)
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
  return { report, error, loading, refresh }
}

export function useTrackingActions(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ text: string; undo: (() => Promise<void>) | null } | null>(null)
  const writing = useRef(false)
  useEffect(() => {
    if (!notice || busy) return
    const timer = setTimeout(() => setNotice(null), 9000)
    return () => clearTimeout(timer)
  }, [notice, busy])
  const act = async (label: string, write: () => Promise<TrackingMutation>): Promise<TrackingMutation | null> => {
    if (writing.current) return null
    writing.current = true
    setBusy(true)
    setError('')
    try {
      const result = await write()
      setNotice({
        text: label,
        undo: async () => {
          await trackingRequest('/undo', { id: result.undoId })
        },
      })
      await refresh()
      return result
    } catch (problem) {
      setError((problem as Error).message)
      return null
    } finally {
      writing.current = false
      setBusy(false)
    }
  }
  const undo = async () => {
    if (!notice?.undo || writing.current) return
    writing.current = true
    setBusy(true)
    setError('')
    try {
      await notice.undo()
      await refresh()
      setNotice(null)
    } catch (problem) {
      setError((problem as Error).message)
    } finally {
      writing.current = false
      setBusy(false)
    }
  }
  return { act, busy, error, setError, notice, setNotice, undo }
}

export type TrackingActions = ReturnType<typeof useTrackingActions>
