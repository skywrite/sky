export interface DayMeeting {
  time: string
  who: string
  medium: string | null
  title: string
  notes: string
  path: string | null
}

/** Complete entries are records; plans and ordinary timed tasks are not meetings. */
export function extractMeetings(lists: Iterable<{ title: string; items: string[] }>): DayMeeting[] {
  const meetings: DayMeeting[] = []
  for (const list of lists) {
    if (!/(?<!in)complete$/i.test(list.title.trim())) continue
    for (const raw of list.items) {
      const timed = raw.trim().match(/^(\d{1,2}:[0-5]\d)\s*>\s*(.*?)\s*->\s*([\s\S]+)$/)
      if (!timed) continue
      const [, time, label, notes] = timed
      const link = notes.match(/\[([^\]]+)\]\((actions\/meetings\/[^)]+)\)/)
      const medium = label.match(
        /^(.*?)\s+(Zoom|In Person|In-Person|FT Audio|FT Video|FaceTime|Google Meet|Teams|Phone|Call)$/i,
      )
      if (!link && !medium) continue
      meetings.push({
        time,
        who: medium?.[1] ?? label,
        medium: medium?.[2] ?? null,
        title: link?.[1] ?? label,
        notes,
        path: link?.[2] ?? null,
      })
    }
  }
  return meetings
}
