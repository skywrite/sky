import { generateText } from 'ai'
import { logAIError } from '#shared/ai/errorLog.ts'
import { aiModelByProfile } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { ClaudeSession } from './claudeCode.ts'
import { dayClock } from './clock.ts'

/** The structured substance of one session, extracted by the digest model. */
export interface SessionDigest {
  /** 3-7 words naming the work, used as the block heading. */
  title: string
  /** One sentence: what the session worked on and where it ended up. */
  about: string
  decided: string[]
  built: string[]
  open: string[]
  learned: string[]
}

const PROMPT_FILE = new URL('../prompts/claude-code-session.prompt.md', import.meta.url).pathname

const FILES_MAX = 60
const PROMPTS_MAX = 120

/** Assemble the per-session material the digest model reads. */
function materials(session: ClaudeSession, day: PlainDate, timezone: string): string {
  const parts: string[] = [`Repo: ${session.repo}`, '', '## Typed prompts (timestamped)']
  for (const prompt of session.promptLog.slice(0, PROMPTS_MAX)) {
    parts.push(`[${dayClock(prompt.instant, day, timezone)}] ${prompt.text}`)
  }
  if (session.promptLog.length > PROMPTS_MAX) {
    parts.push(`… and ${session.promptLog.length - PROMPTS_MAX} more prompts`)
  }

  if (session.commits.length) {
    parts.push('', '## Commits made this session')
    for (const commit of session.commits) parts.push(`- ${commit}`)
  }

  if (session.files.length) {
    parts.push('', '## Files touched')
    for (const file of session.files.slice(0, FILES_MAX)) {
      const rel = session.cwd && file.startsWith(`${session.cwd}/`) ? file.slice(session.cwd.length + 1) : file
      parts.push(`- ${rel}`)
    }
    if (session.files.length > FILES_MAX) parts.push(`- … and ${session.files.length - FILES_MAX} more`)
  }

  if (session.commandLog.length) {
    parts.push('', '## Commands run (descriptions, in order)')
    for (const description of session.commandLog) parts.push(`- ${description}`)
  }

  if (session.finalAssistant) {
    parts.push('', "## Assistant's final message", session.finalAssistant)
  }

  return parts.join('\n')
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

/** Parse and validate the model's JSON reply; null on any shape violation. */
export function parseDigest(text: string): SessionDigest | null {
  const jsonText = text
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/```\s*$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj.title !== 'string' || !obj.title.trim()) return null
  if (typeof obj.about !== 'string' || !obj.about.trim()) return null
  return {
    title: obj.title.trim(),
    about: obj.about.trim(),
    decided: asStrings(obj.decided),
    built: asStrings(obj.built),
    open: asStrings(obj.open),
    learned: asStrings(obj.learned),
  }
}

async function digestSession(
  session: ClaudeSession,
  profile: string,
  day: PlainDate,
  timezone: string,
  instructions: string,
): Promise<SessionDigest | null> {
  try {
    const result = await generateText({
      ...aiModelByProfile(profile),
      instructions,
      prompt: materials(session, day, timezone),
    })
    const digest = parseDigest(result.text)
    if (!digest) {
      await logAIError({
        source: 'recap:claude-code',
        stage: 'parse-digest',
        message: `unparseable digest for session ${session.sessionId}: ${result.text.slice(0, 200)}`,
      })
    }
    return digest
  } catch (err) {
    await logAIError({
      source: 'recap:claude-code',
      stage: 'digest',
      message: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Digest every session in parallel. A failed digest yields null in its slot —
 * the renderer degrades that session to its mechanical trail, so a recap is
 * always written.
 */
export async function digestSessions(
  sessions: ClaudeSession[],
  profile: string,
  day: PlainDate,
  timezone: string,
): Promise<Array<SessionDigest | null>> {
  const content = await readTextFile(PROMPT_FILE)
  const { output: instructions } = renderPromptFile(content, 'claude-code-session.prompt.md')
  return Promise.all(sessions.map((session) => digestSession(session, profile, day, timezone, instructions)))
}
