import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import { readDir, readTextFile } from '#shared/fs/mod.ts'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { commitSubject, type CodingSession, type ScanWindow } from './codingSession.ts'
import { parseInstant } from './parseInstant.ts'

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const GIST_LENGTH = 100
// Caps keep memory and the digest model's input bounded on heavy sessions.
// The prompts COUNT is never capped — only how many are retained verbatim.
const PROMPT_TEXT_CAP = 1_500
const PROMPT_LOG_MAX = 400
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

async function scanFile(filePath: string, window: ScanWindow): Promise<CodingSession | null> {
  let raw: string
  try {
    raw = await readTextFile(filePath)
  } catch {
    return null
  }

  let start: Instant | null = null
  let end: Instant | null = null
  let prompts = 0
  let gist = ''
  let cwd = ''
  let sessionId = ''
  let finalAssistant = ''
  const promptLog: Array<{ instant: Instant; text: string }> = []
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

    const instant = parseInstant(line.timestamp)
    if (!instant) continue
    if (Instant.compare(instant, window.start) < 0 || Instant.compare(instant, window.end) >= 0) continue
    if (line.isSidechain === true) continue

    if (!start || Instant.compare(instant, start) < 0) start = instant
    if (!end || Instant.compare(instant, end) > 0) end = instant

    const prompt = typedPrompt(line)
    if (prompt) {
      prompts += 1
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
  if (prompts === 0 && files.size === 0) return null

  return {
    sessionId: sessionId || path.basename(filePath, '.jsonl'),
    cwd,
    repo: cwd ? path.basename(cwd) : path.basename(path.dirname(filePath)),
    start,
    end,
    prompts,
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
export default async function scanClaudeSessions(projectsDir: string, window: ScanWindow): Promise<CodingSession[]> {
  const projectDirs: string[] = []
  try {
    for await (const entry of readDir(projectsDir)) {
      if (entry.isDirectory && !entry.name.startsWith('wf_')) projectDirs.push(path.join(projectsDir, entry.name))
    }
  } catch {
    return []
  }

  const sessions: CodingSession[] = []
  for (const dir of projectDirs) {
    try {
      for await (const entry of readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith('.jsonl') || entry.name.startsWith('agent-')) continue
        const filePath = path.join(dir, entry.name)
        try {
          const info = await stat(filePath)
          if (info.mtimeMs < window.start.epochMilliseconds) continue
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

  sessions.sort((a, b) => Instant.compare(a.start, b.start))
  return sessions
}
