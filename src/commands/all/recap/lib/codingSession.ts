import * as path from 'node:path'
import { Instant, type PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dayClock, dayLabel } from './clock.ts'
import type { SessionDigest } from './sessionDigest.ts'

export interface ScanWindow {
  start: Instant
  end: Instant
}

export interface CodingSession {
  sessionId: string
  /** The directory the session was launched in. */
  cwd: string
  /** Basename of cwd — the repo/project name. */
  repo: string
  /** First and last in-window event instants. */
  start: Instant
  end: Instant
  /** Prompts the user actually typed — tool results and harness turns excluded. */
  prompts: number
  filesTouched: number
  /** First typed prompt, compressed — the last-resort description. */
  gist: string
  /** Every typed prompt with its instant — the digest model's primary material. */
  promptLog: Array<{ instant: Instant; text: string }>
  /** The assistant's last text message — usually the session's state-of-play. */
  finalAssistant: string
  /** Distinct files changed through edit tools. */
  files: string[]
  /** Command descriptions, in order — the session's action trail. */
  commandLog: string[]
  /** Commit subjects extracted from in-session `git commit` calls. */
  commits: string[]
}

/** Subject line of an in-session `git commit`, from -m or heredoc form. */
export function commitSubject(command: string): string | null {
  if (!command.includes('git commit')) return null
  const heredoc = command.match(/<<'?EOF'?\n([^\n]+)/)
  if (heredoc) return heredoc[1].trim()
  const inline =
    command.match(/-m\s+"([^"\n]+)/) ?? command.match(/-m\s+'([^'\n]+)/) ?? command.match(/-m\s+([^\s"']+)/)
  return inline ? inline[1].trim() : null
}

export interface RenderedRecap {
  body: string
  first: Instant
  last: Instant
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** The session's main work areas: top directories among its touched files. */
export function topDirs(session: CodingSession, limit = 3): string[] {
  const counts = new Map<string, number>()
  for (const file of session.files) {
    const rel = session.cwd && file.startsWith(`${session.cwd}/`) ? file.slice(session.cwd.length + 1) : file
    const dir = path.dirname(rel).split('/').slice(0, 4).join('/')
    if (dir === '.') continue
    counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([dir]) => dir)
}

/**
 * Render the day's sessions as chronological blocks. With a digest, a block
 * carries the session's substance (about/Decided/Built/Open/Learned); without
 * one it degrades to the mechanical trail. `digests[i]` pairs with
 * `sessions[i]`.
 */
export function renderCodingRecap(
  sessions: CodingSession[],
  label: string,
  day: PlainDate,
  timezone: string,
  digests?: Array<SessionDigest | null>,
): RenderedRecap {
  const repos = [...new Set(sessions.map((s) => s.repo))]
  const totalPrompts = sessions.reduce((sum, s) => sum + s.prompts, 0)
  const first = sessions.reduce((min, s) => (Instant.compare(s.start, min) < 0 ? s.start : min), sessions[0].start)
  const last = sessions.reduce((max, s) => (Instant.compare(s.end, max) > 0 ? s.end : max), sessions[0].end)
  const repoLabel = repos.length <= 3 ? repos.join(', ') : plural(repos.length, 'repo')

  const lines: string[] = []
  lines.push(`# ${label} — ${dayLabel(day)}`)
  lines.push('')
  lines.push(`${plural(sessions.length, 'session')} · ${plural(totalPrompts, 'prompt')} · ${repoLabel}`)

  sessions.forEach((session, index) => {
    const digest = digests?.[index] ?? null
    const startClock = dayClock(session.start, day, timezone)
    const endClock = dayClock(session.end, day, timezone)
    const span = startClock === endClock ? startClock : `${startClock} - ${endClock}`
    const title = digest?.title || topDirs(session).join(', ') || session.repo
    const parenParts = [plural(session.prompts, 'prompt')]
    if (repos.length > 1) parenParts.unshift(session.repo)

    lines.push('')
    lines.push(`## ${span} · ${title} (${parenParts.join(', ')})`)
    lines.push('')

    if (digest) {
      lines.push(digest.about)
      for (const item of digest.decided) lines.push(`- Decided: ${item}`)
      for (const item of digest.built) lines.push(`- Built: ${item}`)
      for (const item of digest.open) lines.push(`- Open: ${item}`)
      for (const item of digest.learned) lines.push(`- Learned: ${item}`)
    } else {
      const dirs = topDirs(session)
      if (dirs.length) lines.push(`- Worked in: ${dirs.join(', ')}`)
      for (const commit of session.commits) lines.push(`- Committed: ${commit}`)
      if (session.commandLog.length) lines.push(`- Ran: ${session.commandLog.slice(0, 3).join('; ')}`)
      if (session.gist) lines.push(`- First prompt: ${session.gist}`)
    }
  })

  lines.push('')
  return { body: lines.join('\n'), first, last }
}
