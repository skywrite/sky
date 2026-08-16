import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import { readDir, readTextFile } from '#shared/fs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dayClock, dayLabel } from './clock.ts'
import type { SessionDigest } from './sessionDigest.ts'

export interface ScanWindow {
  start: Date
  end: Date
}

export interface ClaudeSession {
  sessionId: string
  /** The directory the session was launched in. */
  cwd: string
  /** Basename of cwd — the repo/project name. */
  repo: string
  /** First and last in-window event instants. */
  start: Date
  end: Date
  /** Prompts the user actually typed — tool results and harness turns excluded. */
  prompts: number
  filesTouched: number
  /** First typed prompt, compressed — the last-resort description. */
  gist: string
  /** Every typed prompt with its instant — the digest model's primary material. */
  promptLog: Array<{ instant: Date; text: string }>
  /** The assistant's last text message — usually the session's state-of-play. */
  finalAssistant: string
  /** Distinct files changed through edit tools. */
  files: string[]
  /** Bash tool call descriptions, in order — the session's action trail. */
  commandLog: string[]
  /** Commit subjects extracted from in-session `git commit` calls. */
  commits: string[]
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const GIST_LENGTH = 100
// Caps keep the digest model's input bounded on heavy sessions.
const PROMPT_TEXT_CAP = 1_500
const PROMPT_LOG_MAX = 80
const FINAL_ASSISTANT_CAP = 5_000
const COMMAND_LOG_MAX = 40

interface ContentBlock {
  type?: string
  text?: string
  name?: string
  input?: { file_path?: string; command?: string; description?: string }
}

interface JsonlLine {
  type?: string
  timestamp?: string
  isSidechain?: boolean
  cwd?: string
  sessionId?: string
  message?: { content?: unknown }
}

/**
 * A prompt the user typed. String content distinguishes it from tool results
 * (arrays), and a leading '<' marks harness-injected turns (<command-name>,
 * <local-command-stdout>, system reminders) rather than typed ones.
 */
function typedPrompt(line: JsonlLine): string | null {
  if (line.type !== 'user' || line.isSidechain === true) return null
  const content = line.message?.content
  if (typeof content !== 'string') return null
  const text = content.trim()
  if (!text || text.startsWith('<')) return null
  return text
}

/** Subject line of an in-session `git commit`, from -m or heredoc form. */
function commitSubject(command: string): string | null {
  if (!command.includes('git commit')) return null
  const heredoc = command.match(/<<'?EOF'?\n([^\n]+)/)
  if (heredoc) return heredoc[1].trim()
  const inline = command.match(/-m\s+"([^"\n]+)/) ?? command.match(/-m\s+'([^'\n]+)/)
  return inline ? inline[1].trim() : null
}

async function scanFile(filePath: string, window: ScanWindow): Promise<ClaudeSession | null> {
  let raw: string
  try {
    raw = await readTextFile(filePath)
  } catch {
    return null
  }

  let start: Date | null = null
  let end: Date | null = null
  let gist = ''
  let cwd = ''
  let sessionId = ''
  let finalAssistant = ''
  const promptLog: Array<{ instant: Date; text: string }> = []
  const files = new Set<string>()
  const commandLog: string[] = []
  const commits: string[] = []

  for (const lineText of raw.split('\n')) {
    if (!lineText) continue
    let line: JsonlLine
    try {
      line = JSON.parse(lineText) as JsonlLine
    } catch {
      continue
    }
    // First cwd wins: it's the directory the session was launched in. Later
    // lines can carry a different cwd after in-session `cd`s.
    if (!cwd && line.cwd) cwd = line.cwd
    if (!sessionId && line.sessionId) sessionId = line.sessionId
    if (!line.timestamp) continue

    const instant = new Date(line.timestamp)
    if (Number.isNaN(instant.getTime())) continue
    if (instant < window.start || instant >= window.end) continue
    if (line.isSidechain === true) continue

    if (!start || instant < start) start = instant
    if (!end || instant > end) end = instant

    const prompt = typedPrompt(line)
    if (prompt) {
      if (promptLog.length < PROMPT_LOG_MAX) promptLog.push({ instant, text: prompt.slice(0, PROMPT_TEXT_CAP) })
      if (!gist) gist = prompt.replace(/\s+/g, ' ').slice(0, GIST_LENGTH)
    }

    if (line.type === 'assistant' && Array.isArray(line.message?.content)) {
      const textParts: string[] = []
      for (const item of line.message.content as ContentBlock[]) {
        if (item.type === 'text' && item.text) textParts.push(item.text)
        if (item.type !== 'tool_use' || !item.name || !item.input) continue
        if (EDIT_TOOLS.has(item.name) && item.input.file_path) files.add(item.input.file_path)
        if (item.name === 'Bash') {
          if (item.input.description && commandLog.length < COMMAND_LOG_MAX) commandLog.push(item.input.description)
          const subject = item.input.command ? commitSubject(item.input.command) : null
          if (subject) commits.push(subject)
        }
      }
      const text = textParts.join('\n').trim()
      if (text) finalAssistant = text.slice(0, FINAL_ASSISTANT_CAP)
    }
  }

  // No in-window events, or nothing but harness noise (no typed prompts and
  // no edits) — not a session worth recapping.
  if (!start || !end) return null
  if (promptLog.length === 0 && files.size === 0) return null

  return {
    sessionId: sessionId || path.basename(filePath, '.jsonl'),
    cwd,
    repo: cwd ? path.basename(cwd) : path.basename(path.dirname(filePath)),
    start,
    end,
    prompts: promptLog.length,
    filesTouched: files.size,
    gist,
    promptLog,
    finalAssistant,
    files: [...files],
    commandLog,
    commits,
  }
}

/**
 * Scan Claude Code transcripts for sessions active inside the window.
 *
 * Two exclusions keep counts honest: `wf_*` project dirs are workflow runs
 * (one injected prompt per transcript, not typed work), and `agent-*.jsonl`
 * files are subagent transcripts. Within a transcript, sidechain lines are
 * skipped for the same reason.
 *
 * Slicing is by event timestamp, never file mtime — transcripts get touched
 * long after their sessions ended. mtime is only a cheap pre-filter: a file
 * untouched since before the window can't contain in-window events.
 */
export default async function scanClaudeSessions(projectsDir: string, window: ScanWindow): Promise<ClaudeSession[]> {
  const projectDirs: string[] = []
  try {
    for await (const entry of readDir(projectsDir)) {
      if (entry.isDirectory && !entry.name.startsWith('wf_')) projectDirs.push(path.join(projectsDir, entry.name))
    }
  } catch {
    return []
  }

  const sessions: ClaudeSession[] = []
  for (const dir of projectDirs) {
    try {
      for await (const entry of readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith('.jsonl') || entry.name.startsWith('agent-')) continue
        const filePath = path.join(dir, entry.name)
        try {
          const info = await stat(filePath)
          if (info.mtime && info.mtime < window.start) continue
        } catch {
          continue
        }
        const session = await scanFile(filePath, window)
        if (session) sessions.push(session)
      }
    } catch {
      // Unreadable project dir — skip it
    }
  }

  sessions.sort((a, b) => a.start.getTime() - b.start.getTime())
  return sessions
}

export interface RenderedRecap {
  body: string
  first: Date
  last: Date
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** The session's main work areas: top directories among its touched files. */
export function topDirs(session: ClaudeSession, limit = 3): string[] {
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
export function renderClaudeCodeRecap(
  sessions: ClaudeSession[],
  day: PlainDate,
  timezone: string,
  digests?: Array<SessionDigest | null>,
): RenderedRecap {
  const repos = [...new Set(sessions.map((s) => s.repo))]
  const totalPrompts = sessions.reduce((sum, s) => sum + s.prompts, 0)
  const first = sessions.reduce((min, s) => (s.start < min ? s.start : min), sessions[0].start)
  const last = sessions.reduce((max, s) => (s.end > max ? s.end : max), sessions[0].end)
  const repoLabel = repos.length <= 3 ? repos.join(', ') : plural(repos.length, 'repo')

  const lines: string[] = []
  lines.push(`# Claude Code — ${dayLabel(day)}`)
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
