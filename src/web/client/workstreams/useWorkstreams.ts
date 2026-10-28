import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkstreamRecord, WorkstreamReport, WorkstreamRun } from '#lib/workstreams/types.ts'
import { workstreamRequest } from './request.ts'
import type { WorkstreamCommunication } from './WorkstreamDetailContext.ts'

// The workstreams page's data: the status report, the open workstream's runs and communications, and the
// busy/error/notice state of actions run against them. Reads repeat every ten seconds and on focus.
export function useWorkstreams(id: string | null) {
  const [report, setReport] = useState<WorkstreamReport | null>(null)
  const [runs, setRuns] = useState<WorkstreamRun[]>([])
  const [communications, setCommunications] = useState<WorkstreamCommunication[]>([])
  const readSequence = useRef(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const sequence = ++readSequence.current
    const next = await workstreamRequest<WorkstreamReport>('/status')
    if (sequence !== readSequence.current) return
    setReport(next)
    if (id && next.items.some((item) => item.id === id)) {
      const detail = await workstreamRequest<{
        workstream: WorkstreamRecord
        runs: WorkstreamRun[]
        communications?: WorkstreamCommunication[]
      }>(`/${encodeURIComponent(id)}`)
      if (sequence !== readSequence.current) return
      setRuns(detail.runs)
      setCommunications(detail.communications ?? [])
    } else {
      setRuns([])
      setCommunications([])
    }
  }, [id])
  const latest = useRef(load)
  latest.current = load
  // Stable, so a callback created before navigation still reads the workstream open afterwards.
  const refresh = useCallback(() => latest.current(), [])
  useEffect(() => {
    let alive = true
    const read = () => {
      if (alive)
        void load().catch((problem: Error) => {
          if (alive) setError(problem.message)
        })
    }
    read()
    const timer = setInterval(read, 10_000)
    window.addEventListener('focus', read)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [load])
  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      await refresh()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Sky could not complete this step.')
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  // Publish a result now; a read started before it must not replace it when it lands.
  const replaceReport = (update: (current: WorkstreamReport | null) => WorkstreamReport | null) => {
    ++readSequence.current
    setReport(update)
  }
  return { report, runs, communications, error, notice, busy, setError, setNotice, refresh, act, replaceReport }
}
