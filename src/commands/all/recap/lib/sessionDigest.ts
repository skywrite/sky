import { generateObject } from 'ai'
import { z } from 'zod'
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

/**
 * Schema enforced at the API layer. Free-text JSON replies broke on the
 * model's own output (unescaped quotes inside a string value); structured
 * output makes that failure class impossible rather than repairing it.
 */
const digestSchema = z.object({
  title: z.string(),
  about: z.string(),
  decided: z.array(z.string()),
  built: z.array(z.string()),
  open: z.array(z.string()),
  learned: z.array(z.string()),
})

// generateObject has no timeout option; an unbounded call can hang forever
// (see enrich/classify.ts). Session materials run far longer than a tag
// pick's transcript, so this allows double the enrich budget.
const AI_TIMEOUT_MS = 120_000

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

function nonBlank(items: string[]): string[] {
  return items.filter((item) => item.trim().length > 0)
}

/** Trim a schema-shaped digest; null when title or about is blank. */
export function normalizeDigest(raw: z.infer<typeof digestSchema>): SessionDigest | null {
  const title = raw.title.trim()
  const about = raw.about.trim()
  if (!title || !about) return null
  return {
    title,
    about,
    decided: nonBlank(raw.decided),
    built: nonBlank(raw.built),
    open: nonBlank(raw.open),
    learned: nonBlank(raw.learned),
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
    const { object } = await generateObject({
      ...aiModelByProfile(profile),
      schema: digestSchema,
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
      instructions,
      prompt: materials(session, day, timezone),
    })
    const digest = normalizeDigest(object)
    if (!digest) {
      await logAIError({
        source: 'recap:claude-code',
        stage: 'parse-digest',
        message: `blank digest for session ${session.sessionId}: ${JSON.stringify(object).slice(0, 200)}`,
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
