import * as path from 'node:path'
import { DIR_TIME } from '#config'
import { loadStreaks } from '#lib/streaks/mod.ts'
import { exists, readDir, readTextFile } from '#shared/fs/mod.ts'
import { streaksItemsFromDay } from '#shared/models/Streak/mod.ts'
import { dayDir, dayFile, fetchNowSync, readDay } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

export interface TodayMostImportant {
  label: string
  relativePath: string
}

export interface TodayStreak {
  title: string
  doneToday: boolean
}

export interface TodaySection {
  /** e.g. "Friday, July 31, 2026" */
  dateLabel: string
  ymd: string
  /** Link target for today's day file, null when it doesn't exist yet */
  dayRelativePath: string | null
  mostImportant: TodayMostImportant[]
  streaks: TodayStreak[]
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const HEADING_PATTERN = /^#{1,6}\s+(.+?)\s*$/m

/**
 * Assemble the Today section from the notebook. Every part is
 * failure-tolerant: a missing day file, empty streaks dir, or unreadable
 * MI just drops that part rather than failing the page.
 */
export async function buildTodaySection(markdownBaseDir: string): Promise<TodaySection | null> {
  let today: PlainDate
  try {
    today = fetchNowSync().plainDateTime.plainDate
  } catch {
    return null
  }

  const [dayRelativePath, mostImportant, streaks] = await Promise.all([
    findDayFile(markdownBaseDir, today),
    findMostImportant(markdownBaseDir, today),
    findStreaks(today),
  ])

  return {
    dateLabel: formatDateLabel(today),
    ymd: today.ymd,
    dayRelativePath,
    mostImportant,
    streaks,
  }
}

function formatDateLabel(date: PlainDate): string {
  const weekday = WEEKDAYS[date.toDate().getDay()]
  return `${weekday}, ${MONTHS[date.month - 1]} ${date.day}, ${date.year}`
}

async function findDayFile(markdownBaseDir: string, today: PlainDate): Promise<string | null> {
  try {
    const absolutePath = path.join(DIR_TIME, dayFile(today))
    if (!(await exists(absolutePath))) return null
    return path.relative(markdownBaseDir, absolutePath)
  } catch {
    return null
  }
}

async function findMostImportant(markdownBaseDir: string, today: PlainDate): Promise<TodayMostImportant[]> {
  try {
    const miDir = path.join(DIR_TIME, dayDir(today), 'most-important')
    if (!(await exists(miDir))) return []

    const items: TodayMostImportant[] = []
    for await (const entry of readDir(miDir)) {
      if (!entry.isFile || path.extname(entry.name) !== '.md') continue

      const filePath = path.join(miDir, entry.name)
      items.push({
        label: await readMostImportantLabel(filePath, entry.name),
        relativePath: path.relative(markdownBaseDir, filePath),
      })
    }

    items.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    return items
  } catch {
    return []
  }
}

async function readMostImportantLabel(filePath: string, fileName: string): Promise<string> {
  try {
    const heading = (await readTextFile(filePath)).match(HEADING_PATTERN)
    if (heading?.[1]) return heading[1]
  } catch {
    // fall through to the filename
  }
  return path.basename(fileName, '.md')
}

async function findStreaks(today: PlainDate): Promise<TodayStreak[]> {
  try {
    const loaded = await loadStreaks('active')
    if (loaded.length === 0) return []

    let struckItems: string[] = []
    try {
      const day = await readDay(today)
      struckItems = streaksItemsFromDay(day).filter((item) => item.includes('~~'))
    } catch {
      // No day file yet — nothing struck.
    }

    return loaded.map(({ streak }) => ({
      title: streak.title,
      doneToday: struckItems.some((item) => item.toLowerCase().includes(streak.title.toLowerCase())),
    }))
  } catch {
    return []
  }
}
