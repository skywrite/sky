import { useEffect, useMemo, useState } from 'react'
import { rangeKey } from '#lib/calendarScheduler/availabilityMessage.ts'
import type { AvailabilityDay, TimeRange } from '#lib/calendarScheduler/findTime.ts'

interface Choices {
  query: string
  excluded: TimeRange[]
  proposed?: Set<string>
}

export function useProposedRanges(query: string, days: AvailabilityDay[] | null, updatingFilters: boolean) {
  const [saved, setSaved] = useState<Choices | null>(null)
  const choices = saved?.query === query ? saved : null
  const openings = useMemo(() => days?.flatMap((day) => day.entries.filter((e) => e.kind === 'free')) ?? [], [days])
  const selection = useMemo(() => {
    if (!choices) return null
    if (choices.proposed) return choices.proposed
    // A merged opening that includes time the user turned off needs their click before it can be offered.
    return new Set(
      openings
        .filter((range) => !choices.excluded.some((off) => off.start < range.end && range.start < off.end))
        .map(rangeKey),
    )
  }, [choices, openings])

  useEffect(() => {
    // Only an explicit filter edit admits newly freed time. Freeze the reviewed ranges for subsequent calendar refreshes.
    if (choices && !choices.proposed && days?.some((day) => !day.warnings.length) && !updatingFilters && selection)
      setSaved({ ...choices, proposed: selection })
  }, [choices, days, selection, updatingFilters])

  return {
    selection,
    reset: () => setSaved(null),
    beforeFilterChange: () => {
      if (choices?.proposed) setSaved({ query, excluded: choices.excluded })
    },
    toggle: (range: TimeRange) => {
      const key = rangeKey(range)
      const next = new Set(selection ?? openings.map(rangeKey))
      const excluded = choices?.excluded ?? []
      if (next.delete(key)) {
        setSaved({ query, proposed: next, excluded: [...excluded, { start: range.start, end: range.end }] })
      } else {
        next.add(key)
        // Re-offering part of an excluded interval keeps the portions on either side excluded.
        const remaining = excluded.flatMap((off) =>
          [
            { start: off.start, end: Math.min(off.end, range.start) },
            { start: Math.max(off.start, range.end), end: off.end },
          ].filter((part) => part.start < part.end),
        )
        setSaved({ query, proposed: next, excluded: remaining })
      }
    },
  }
}
