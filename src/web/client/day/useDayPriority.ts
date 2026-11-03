import { useEffect, useRef, useState } from 'react'
import type { PriorityGroup } from '#lib/nbfs/priorityOrder.ts'
import type { DayData } from './day.tsx'

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
  const live = useRef({ paused, applyView })
  live.current = { paused, applyView }
  const ymd = day?.day.ymd
  const enabled = Boolean(day?.day.dayRelativePath && !day.record.summarized)
  const revision = group === 'todos' ? day?.record.todoOrderRevision : day?.record.reminderOrderRevision
  const hasItems =
    group === 'todos'
      ? (day?.record.todos.length ?? 0) + (day?.record.commitments.length ?? 0) > 1
      : (day?.record.reminders.length ?? 0) > 1
  useEffect(() => {
    if (!enabled || !ymd || !hasItems || paused) return
    const controller = new AbortController()
    let running = false
    let force = retry > 0
    const refresh = async () => {
      if (running || live.current.paused || document.visibilityState === 'hidden') return
      running = true
      setLoading(true)
      try {
        const response = await fetch(`/day/${ymd}/${group === 'todos' ? 'todo' : 'reminder'}-priority`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ retry: force }),
          signal: controller.signal,
        })
        force = false
        if (!response.ok) throw new Error('Priority suggestions are unavailable.')
        const result = (await response.json()) as { view?: DayData }
        if (!controller.signal.aborted && !live.current.paused && result.view) live.current.applyView(result.view)
        if (!controller.signal.aborted) setFailure(!result.view)
      } catch {
        if (!controller.signal.aborted) setFailure(true)
      } finally {
        running = false
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    return () => {
      controller.abort()
      clearInterval(timer)
      setLoading(false)
    }
  }, [ymd, group, enabled, revision, hasItems, paused, retry])
  return { loading, failure, retry: () => setRetry((value) => value + 1) }
}
