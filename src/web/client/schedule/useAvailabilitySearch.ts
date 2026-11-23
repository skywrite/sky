import { useEffect, useState } from 'react'
import type { AvailabilityResult, AvailabilitySearch } from '#lib/calendarScheduler/findTime.ts'
import { meetingRequest } from '../meetings/meetingRequest.ts'

export function useAvailabilitySearch(
  active: boolean,
  text: string,
  timezone: string | undefined,
  disabledCalendars: string[],
  ignoredEvents: string[],
) {
  const [parsed, setParsed] = useState<{ text: string; search: AvailabilitySearch } | null>(null)
  const [result, setResult] = useState<
    | (AvailabilityResult & {
        search: AvailabilitySearch
        disabledCalendars: string[]
        ignoredEvents: string[]
      })
    | null
  >(null)
  const [parseError, setParseError] = useState('')
  const [calendarError, setCalendarError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const search = parsed?.text === text ? parsed.search : null
  const interpreted = !!search

  useEffect(() => {
    setParseError('')
    if (!active || !text || !timezone || interpreted) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void meetingRequest<AvailabilitySearch>('availability/interpret', { query: text, timezone }, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setParsed({ text, search: next })
        })
        .catch((error: Error) => {
          if (!controller.signal.aborted) setParseError(error.message)
        })
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [active, text, timezone, interpreted, attempt])

  useEffect(() => {
    if (!active || !search) return
    const update = () => setRefresh((current) => current + 1)
    const timer = setInterval(update, 60_000)
    window.addEventListener('focus', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', update)
    }
  }, [active, search])

  useEffect(() => {
    setCalendarError('')
    if (!active || !search || !timezone) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void meetingRequest<AvailabilityResult>(
        'availability/windows',
        { ...search, disabledCalendars, ignoredEvents },
        controller.signal,
      )
        .then((data) => {
          if (!controller.signal.aborted) setResult({ ...data, search, disabledCalendars, ignoredEvents })
        })
        .catch((error: Error) => {
          if (controller.signal.aborted) return
          setResult((previous) => previous && { ...previous, search, days: [], disabledCalendars, ignoredEvents })
          setCalendarError(error.message)
        })
    }, 180)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [active, search, timezone, refresh, disabledCalendars, ignoredEvents])

  return {
    search,
    days: search && result?.search === search && timezone && result.days.length ? result.days : null,
    calendars: result?.calendars ?? [],
    updatingFilters:
      !!result && (result.disabledCalendars !== disabledCalendars || result.ignoredEvents !== ignoredEvents),
    error: search ? calendarError : parseError,
    change: (change: Partial<AvailabilitySearch>) => {
      if (search) setParsed({ text, search: { ...search, ...change } })
    },
    retry: () => (search ? setRefresh((value) => value + 1) : setAttempt((value) => value + 1)),
  }
}
