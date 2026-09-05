/**
 * The week's accountability ledger, checkins.md, read for the page: how
 * many entries there are and what the latest one says — its grade and
 * verdict line, the status it gave each goal, and the plan edits it
 * suggests. The entries are week:checkin's own format; nothing here grades
 * anything, and the plan's goals are matched to the entry's by their words
 * because the entry compresses each goal to a recognizable phrase.
 */

import type { PlanGoal } from './plan.ts'

export interface CheckinGoal {
  /** done · on track · at risk · no motion · dropped */
  status: string
  text: string
  evidence: string | null
}

export interface CheckinEntry {
  /** `YYYY-MM-DD` */
  day: string
  /** `6:24` — the notebook time, hour unpadded */
  time: string
  /** `day 4 of 7`, or the final reckoning's words */
  position: string
  /** `B`, `A-` — null when the entry opens without one */
  grade: string | null
  verdict: string | null
  goals: CheckinGoal[]
  edits: string[]
}

export interface WeekCheckins {
  count: number
  latest: CheckinEntry | null
}

const ENTRY = /^## Checkin — \w{3} (\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}) \((.+?)\)\s*$/
const GRADE = /^\*\*Grade:\s*([A-F][+-−]?)\*\*\s*(?:[—–-]\s*)?(.*)$/
const H3 = /^###\s+(.+?)\s*$/
const GOAL = /^-\s+\*\*([A-Z][A-Z ]*?)\*\*\s*(.+?)\s*$/
const NUMBERED = /^\d+\.\s+(.+?)\s*$/
const BULLET = /^-\s+(.+?)\s*$/
const COMMENT = /^<!--.*-->\s*$/

/** `phrase — evidence`: the first dash with space on both sides splits them. */
function splitEvidence(rest: string): { text: string; evidence: string | null } {
  const at = rest.search(/\s[—–-]\s/)
  if (at < 0) return { text: rest.trim(), evidence: null }
  return {
    text: rest.slice(0, at).trim(),
    evidence:
      rest
        .slice(at)
        .replace(/^\s[—–-]\s/, '')
        .trim() || null,
  }
}

function parseEntry(heading: RegExpMatchArray, lines: string[]): CheckinEntry {
  const entry: CheckinEntry = {
    day: heading[1],
    time: heading[2],
    position: heading[3],
    grade: null,
    verdict: null,
    goals: [],
    edits: [],
  }
  let section = ''
  for (const line of lines) {
    if (!line.trim() || COMMENT.test(line)) continue
    const h3 = line.match(H3)
    if (h3) {
      section = h3[1].toLowerCase()
      continue
    }
    if (!section) {
      const grade = line.match(GRADE)
      if (grade && entry.grade === null) {
        entry.grade = grade[1]
        entry.verdict = grade[2].trim() || null
      }
      continue
    }
    if (section === 'goals') {
      const goal = line.match(GOAL)
      if (goal) entry.goals.push({ status: goal[1].toLowerCase(), ...splitEvidence(goal[2]) })
    } else if (section === 'suggested edits') {
      const edit = line.match(NUMBERED) ?? line.match(BULLET)
      const text = (edit?.[1] ?? line).trim()
      if (/^none\b/i.test(text)) continue
      if (edit) entry.edits.push(text)
    }
  }
  return entry
}

export function parseCheckins(md: string): WeekCheckins {
  const lines = md.split('\n')
  const starts: number[] = []
  lines.forEach((line, i) => {
    if (ENTRY.test(line)) starts.push(i)
  })
  if (starts.length === 0) return { count: 0, latest: null }
  const last = starts[starts.length - 1]
  const heading = lines[last].match(ENTRY)!
  return { count: starts.length, latest: parseEntry(heading, lines.slice(last + 1)) }
}

// --- matching the entry's goals to the plan's ---------------------------------------

const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'week', 'day'])

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP.has(word)),
  )
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared++
  return shared / Math.min(a.size, b.size)
}

/**
 * The entry's status for each plan goal, by word overlap: the entry names
 * goals in its own compressed words, so a goal takes the entry line that
 * shares most of the shorter side's words, each line given away once. A goal
 * the entry never mentions gets null, never a neighbour's status.
 */
export function statusesFor(goals: PlanGoal[], entry: CheckinEntry | null): (CheckinGoal | null)[] {
  if (!entry || entry.goals.length === 0) return goals.map(() => null)
  const goalWords = goals.map((goal) => words(goal.text))
  const entryWords = entry.goals.map((goal) => words(goal.text))
  const pairs: { goal: number; line: number; score: number }[] = []
  goalWords.forEach((gw, goal) => {
    entryWords.forEach((ew, line) => {
      const score = overlap(gw, ew)
      if (score >= 0.5) pairs.push({ goal, line, score })
    })
  })
  pairs.sort((a, b) => b.score - a.score)
  const taken = new Set<number>()
  const result: (CheckinGoal | null)[] = goals.map(() => null)
  for (const pair of pairs) {
    if (result[pair.goal] || taken.has(pair.line)) continue
    result[pair.goal] = entry.goals[pair.line]
    taken.add(pair.line)
  }
  return result
}
