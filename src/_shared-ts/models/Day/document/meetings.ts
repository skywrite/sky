import { entryLengthMinutes } from '#universal/dates/entryLength.ts'

export interface DayMeeting {
  time: string
  minutes?: number
  who: string
  medium: string | null
  title: string
  notes: string
  path: string | null
}

/** A meeting needs a recognized medium or a link to meeting notes, beyond the prose arrow. */
export function parseMeetingEntry(raw: string): DayMeeting | null {
  const timed = raw
    .trim()
    .match(
      /^(?<time>\d{1,2}:[0-5]\d)(?<length>\s*\([^()>]*\)|\s+[^\s>][^>]*?)?\s*>\s*(?<label>.*?)\s*->\s*(?<notes>[\s\S]+)$/,
    )
  if (!timed?.groups) return null
  const { time, length, label, notes } = timed.groups
  const minutes = length ? entryLengthMinutes(length) : null
  if (length && minutes === null) return null
  const link = notes.match(/\[([^\]]+)\]\((actions\/meetings\/[^)]+)\)/)
  const medium = label.match(
    /^(.*?)\s+(Zoom|In Person|In-Person|FT Audio|FT Video|FaceTime|Google Meet|Teams|Phone|Call)$/i,
  )
  if (!link && !medium) return null
  return {
    time,
    ...(minutes ? { minutes } : {}),
    who: medium?.[1] ?? label,
    medium: medium?.[2] ?? null,
    title: link?.[1] ?? label,
    notes,
    path: link?.[2] ?? null,
  }
}

/** Complete entries are records; plans and ordinary timed tasks are not meetings. */
export function extractMeetings(lists: Iterable<{ title: string; items: string[] }>): DayMeeting[] {
  const meetings: DayMeeting[] = []
  for (const list of lists) {
    if (!/(?<!in)complete$/i.test(list.title.trim())) continue
    for (const raw of list.items) {
      const meeting = parseMeetingEntry(raw)
      if (meeting) meetings.push(meeting)
    }
  }
  return meetings
}
