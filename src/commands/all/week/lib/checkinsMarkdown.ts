import type { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'

/**
 * Rendering for checkins.md — the week's accountability ledger, sibling to
 * week.md in the week directory. The file opens with a verbatim snapshot of
 * week.md as first seen (the original plan every later drift and deviation
 * analysis measures against) and accumulates one dated entry per
 * week:checkin run, append-only. week.md itself stays the owner's pen: no
 * function here ever produces content for it.
 */

/** A fence long enough that the fenced content can never terminate it early:
 * one backtick more than the content's longest run, floor four. */
export function fenceFor(content: string): string {
  const runs = content.match(/`+/g) ?? []
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0)
  return '`'.repeat(Math.max(4, longest + 1))
}

/** Notebook times print with the hour unpadded (9:05, not 09:05). */
export function unpadHour(time: string): string {
  return time.replace(/^0(?=\d:)/, '')
}

/** 1-based position of a day within the week's Mon–Sun run, undefined outside it. */
export function dayNumberInWeek(week: Week, day: PlainDate): number | undefined {
  const idx = week.days.findIndex((d) => d.ymd === day.ymd)
  return idx === -1 ? undefined : idx + 1
}

export function entryHeading(week: Week, day: PlainDate, time: string): string {
  const n = dayNumberInWeek(week, day)
  const position = n === undefined ? 'after week end — final reckoning' : `day ${n} of ${week.days.length}`
  return `## Checkin — ${day.dayShort} ${day.ymd} ${unpadHour(time)} (${position})`
}

export function renderSnapshotSection(weekMd: string, capturedYmd: string): string {
  const fence = fenceFor(weekMd)
  return [
    `## Plan snapshot — captured ${capturedYmd}`,
    '',
    '_week.md as first seen by week:checkin. End-of-week deviation is measured against this; week.md itself keeps changing by hand._',
    '',
    `${fence}markdown`,
    weekMd.trimEnd(),
    fence,
  ].join('\n')
}

export function renderCheckinsFile(week: Week, createdYmd: string, weekMd: string, entry: string): string {
  return [
    '---',
    `created: ${createdYmd}`,
    `updated: ${createdYmd}`,
    '---',
    '',
    `# ${week.toString()}: Checkins`,
    '',
    renderSnapshotSection(weekMd, createdYmd),
    '',
    entry.trimEnd(),
    '',
  ].join('\n')
}

export function appendCheckin(existing: string, entry: string, updatedYmd: string): string {
  return `${bumpUpdated(existing, updatedYmd).trimEnd()}\n\n${entry.trimEnd()}\n`
}

/** Bump `updated:` inside the leading frontmatter only — hand-edited or
 * frontmatter-less files pass through untouched and the append still lands. */
function bumpUpdated(md: string, ymd: string): string {
  const fm = md.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return md
  return md.replace(fm[0], `---\n${fm[1].replace(/^updated: .*$/m, `updated: ${ymd}`)}\n---`)
}
