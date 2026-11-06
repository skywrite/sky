import { useEffect, useRef, useState } from 'react'
import type { PriorityGroup } from '#lib/nbfs/priorityOrder.ts'
import type { DayData } from './day.tsx'

/**
 * A ranking Sky already made answers in well under a second; a slower answer means it is asking the model again.
 * Only that earns the status line, so quick answers don't make the lists jump.
 */
const STATUS_AFTER_MS = 1000
const CHANGE_SETTLE_MS = 500

/** Contextual ranking never blocks the day or interrupts an active organize gesture. */
export function useDayPriority(
  day: DayData | null,
  group: PriorityGroup,
  paused: boolean,
  applyView: (view: DayData) => void,
) {
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState(false)
  const [retry, setRetry] = useState(0)
  const settled = useRef<string | null>(null)
  const retried = useRef(0)
  const live = useRef({ paused, applyView })
  live.current = { paused, applyView }
  const ymd = day?.day.ymd
  const enabled = Boolean(day?.day.dayRelativePath && !day.record.summarized)
  const priority = group === 'todos' ? day?.record.todoPriority : day?.record.reminderPriority
  const revision = priority?.inputRevision
  const rankedRevision = priority?.revision
  const hasItems =
    group === 'todos'
      ? [...(day?.record.todos ?? []), ...(day?.record.commitments ?? [])].filter((item) => !item.done).length > 1
      : (day?.record.reminders.filter((item) => !item.done).length ?? 0) > 1
  useEffect(() => {
    // A deletion can return to older inputs after the saved ranking has moved on.
    settled.current = null
  }, [ymd, group, revision])
  useEffect(() => {
    if (!enabled || !ymd || !revision || !hasItems || paused) return
    const key = JSON.stringify([ymd, group, revision, retry])
    const force = retry > retried.current
    if (settled.current === key || (!force && rankedRevision === revision)) return
    const controller = new AbortController()
    let running = false
    let status: ReturnType<typeof setTimeout> | undefined
    let debounce: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      if (running || settled.current === key || live.current.paused || document.visibilityState === 'hidden') return
      running = true
      status = setTimeout(() => setLoading(true), STATUS_AFTER_MS)
      try {
        const response = await fetch(`/day/${ymd}/${group === 'todos' ? 'todo' : 'reminder'}-priority`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ retry: force }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Priority suggestions are unavailable.')
        const result = (await response.json()) as { view?: DayData }
        if (!controller.signal.aborted && !live.current.paused && result.view) live.current.applyView(result.view)
        if (!controller.signal.aborted) setFailure(!result.view)
      } catch {
        if (!controller.signal.aborted) setFailure(true)
      } finally {
        clearTimeout(status)
        running = false
        if (!controller.signal.aborted) {
          settled.current = key
          retried.current = retry
          setLoading(false)
        }
      }
    }
    const schedule = () => {
      clearTimeout(debounce)
      debounce = setTimeout(() => void refresh(), CHANGE_SETTLE_MS)
    }
    schedule()
    // A change received in a hidden tab waits until it is visible; unchanged inputs do no work.
    document.addEventListener('visibilitychange', schedule)
    return () => {
      controller.abort()
      document.removeEventListener('visibilitychange', schedule)
      clearTimeout(debounce)
      clearTimeout(status)
      setLoading(false)
    }
  }, [ymd, group, enabled, revision, rankedRevision, hasItems, paused, retry])
  return { loading, failure, retry: () => setRetry((value) => value + 1) }
}
