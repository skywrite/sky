import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { attentionQueue } from '#lib/outbox/attentionQueue.ts'
import type { OutboxRecord } from '#lib/outbox/types.ts'
import type { OutboxReport } from '../../outbox/mod.ts'

/**
 * The outbox's data, as hooks: the report the pages read, one item's
 * record, the unfinished edits kept across pages, and the wrapper every
 * action runs in.
 */

export async function outboxRequest<T>(url: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/outbox/_api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? 'Outbox could not complete this step.')
  return body as T
}

/** Whether the report describes work in progress that the page should follow closely. */
export function outboxWorking(report: OutboxReport | null): boolean {
  if (!report) return false
  return (
    report.check?.running === true ||
    report.followupsRunning === true ||
    report.items.some(
      (item) =>
        item.composition?.status === 'running' ||
        item.status === 'placing' ||
        (['pending', 'preparing'].includes(item.followupStatus ?? '') && item.status === 'ready'),
    )
  )
}

/**
 * The report behind both pages. It is re-read every minute, every two
 * seconds while something runs or an item is open, and whenever the window
 * regains focus. A failed read shows as a connection banner until one succeeds.
 */
export function useOutboxReport(fast: boolean) {
  const [report, setReport] = useState<OutboxReport | null>(null)
  const [connectionError, setConnectionError] = useState(false)
  const receiveReport = useCallback((value: OutboxReport) => {
    setReport(value)
    setConnectionError(false)
  }, [])
  const refresh = useCallback(async () => receiveReport(await outboxRequest<OutboxReport>('/status')), [receiveReport])
  const polling = fast || outboxWorking(report)
  useEffect(() => {
    let alive = true
    const read = () =>
      outboxRequest<OutboxReport>('/status')
        .then((value) => {
          if (alive) receiveReport(value)
        })
        .catch(() => {
          if (alive) setConnectionError(true)
        })
    void read()
    window.addEventListener('focus', read)
    const timer = setInterval(read, polling || connectionError ? 2_000 : 60_000)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [polling, connectionError, receiveReport])
  return { report, setReport, connectionError, setConnectionError, refresh, receiveReport }
}

/** The report's copy of an item, from whichever list holds it. */
export function findInReport(report: OutboxReport | null, id: string): OutboxRecord | undefined {
  if (!report || !id) return undefined
  return (
    report.items.find((candidate) => candidate.id === id) ??
    report.awaitingCheck?.find((candidate) => candidate.id === id) ??
    (report.done ?? []).find((candidate) => candidate.id === id)
  )
}

/**
 * One item's record. The report's copy when it lists the item; else the
 * record read for this page — a finished item, or one the report no longer
 * carries. Every fresh read reaches `onRecord`, so an editor can adopt it.
 */
export function useOutboxItem(
  id: string,
  report: OutboxReport | null,
  setReport: (update: (current: OutboxReport | null) => OutboxReport | null) => void,
  onRecord: (record: OutboxRecord) => void,
) {
  const [fetched, setFetched] = useState<OutboxRecord | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const idRef = useRef(id)
  idRef.current = id
  const onRecordRef = useRef(onRecord)
  onRecordRef.current = onRecord
  const receiveItem = useCallback(
    (record: OutboxRecord) => {
      setReport((current) =>
        current
          ? {
              ...current,
              ...attentionQueue(
                [...current.items, ...(current.awaitingCheck ?? [])].map((entry) =>
                  entry.id === record.id ? record : entry,
                ),
              ),
            }
          : current,
      )
      if (idRef.current === record.id) {
        setFetched(record)
        onRecordRef.current(record)
      }
    },
    [setReport],
  )
  useEffect(() => {
    setFetched(null)
    setError('')
    if (!id) return
    let alive = true
    setLoading(true)
    void outboxRequest<OutboxRecord>(`/item/${encodeURIComponent(id)}`)
      .then((record) => {
        if (alive) receiveItem(record)
      })
      .catch((problem) => {
        if (alive) setError(problem instanceof Error ? problem.message : 'Could not open this item.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id, receiveItem])
  const item = findInReport(report, id) ?? (fetched?.id === id ? fetched : undefined)
  return { item, error, loading, receiveItem }
}

export type Edit = { text: string; revision: string; saved: string; direction?: string; compositionId?: string }

/** The editor's state for a record as the service holds it. */
export function savedEdit(record: OutboxRecord): Edit {
  return {
    text: record.draft,
    revision: record.revision,
    saved: record.draft,
    direction: record.composition?.status === 'complete' ? undefined : record.replyDirections?.at(-1)?.text,
    compositionId: record.composition?.status === 'running' ? record.composition.id : undefined,
  }
}

// Going to another Sky page must not discard an unfinished edit.
const edits = new Map<string, Edit>()

/**
 * Unfinished edits, by item. They outlive the page and guard the window
 * against closing. An edit for an item the report shows as finished is
 * dropped, except the open item's; an item the report does not list
 * keeps its edit, since it can still be opened by its link.
 */
export function useDraftEdits(report: OutboxReport | null, openId: string) {
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if ([...edits.values()].some((value) => value.text !== value.saved || value.direction?.trim()))
        event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  useEffect(() => {
    if (!report) return
    const finished = new Set((report.done ?? []).map((record) => record.id))
    for (const id of edits.keys()) if (id !== openId && finished.has(id)) edits.delete(id)
  }, [report, openId])
  return useMemo(
    () => ({
      get: (id: string) => edits.get(id),
      has: (id: string) => edits.has(id),
      set: (id: string, edit: Edit) => edits.set(id, edit),
      remove: (id: string) => edits.delete(id),
      /** The unsaved wording for an item, or empty. */
      textOf: (id: string) => edits.get(id)?.text ?? '',
    }),
    [],
  )
}

export type DraftEdits = ReturnType<typeof useDraftEdits>

/**
 * The wrapper every action runs in: one at a time, the report re-read
 * afterwards, a failure kept as the page's error.
 */
export function useOutboxAction(refresh: () => Promise<void>, blocked = false) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const act = useCallback(
    async (action: () => Promise<void>) => {
      if (busyRef.current || blockedRef.current) return
      busyRef.current = true
      setBusy(true)
      setError('')
      try {
        await action()
        await refresh()
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : 'Outbox could not complete this step.')
        await refresh().catch(() => {})
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [refresh],
  )
  return { busy, error, setError, act }
}

/** Per-viewer conveniences kept in this browser; absent or blocked storage reads as nothing. */
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Then the convenience lasts for this visit only.
  }
}
