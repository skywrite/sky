import * as path from 'node:path'
import * as os from 'node:os'
import { appendFile, mkdir } from 'node:fs/promises'
import type { Warning } from 'ai'
import colors from 'picocolors'
import { DIR_USER_DATA } from '#config'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

/**
 * Persistent JSONL log for AI pipeline failures.
 *
 * The ai:chat context pipeline keeps the conversation flowing when a query
 * fails, which used to mean errors scrolled by in dim terminal output and
 * were lost — along with the context the chat silently answered without.
 * Every failure is appended here so those gaps can be diagnosed later.
 *
 * Inspect with: tail -20 <userDataDir>/logs/ai-errors.jsonl | jq
 */

export const AI_ERROR_LOG_PATH = path.join(DIR_USER_DATA, 'logs', 'ai-errors.jsonl')

/** Home-relative form of the log path for terminal display. */
export const AI_ERROR_LOG_DISPLAY = AI_ERROR_LOG_PATH.startsWith(os.homedir())
  ? `~${AI_ERROR_LOG_PATH.slice(os.homedir().length)}`
  : AI_ERROR_LOG_PATH

export interface AIErrorEntry {
  /** Command or subsystem reporting the failure, e.g. 'ai:chat', 'markdown:sel' */
  source: string
  /** Pipeline stage, e.g. 'context:files', 'context:evolve', 'query:server', 'turn' */
  stage?: string
  /** Human-readable summary of what failed */
  message: string
  /** GraphQL query that failed, if any */
  query?: string
  /** Individual GraphQL error messages */
  errors?: string[]
  /** The user question/message that triggered the pipeline, if known */
  question?: string
}

/**
 * Append a failure to the AI error log. Never throws — logging must not
 * break the pipeline it observes.
 */
export async function logAIError(entry: AIErrorEntry): Promise<void> {
  try {
    await mkdir(path.dirname(AI_ERROR_LOG_PATH), { recursive: true })
    const line = JSON.stringify({ ts: ZonedDateTime.now().toString(), ...entry })
    await appendFile(AI_ERROR_LOG_PATH, line + '\n', 'utf8')
  } catch {
    // Swallow: a broken log file must never take down a chat turn
  }
}

/** Render an AI SDK warning as a single line, mirroring the SDK's own formatter. */
export function formatAIWarning(warning: Warning): string {
  switch (warning.type) {
    case 'unsupported':
      return `unsupported feature "${warning.feature}"${warning.details ? `: ${warning.details}` : ''}`
    case 'compatibility':
      return `compatibility mode for "${warning.feature}"${warning.details ? `: ${warning.details}` : ''}`
    case 'deprecated':
      return `deprecated "${warning.setting}": ${warning.message}`
    case 'other':
      return warning.message
    default:
      return JSON.stringify(warning)
  }
}

/**
 * Route AI SDK warnings (e.g. "unsupported reasoning metadata") into this log,
 * announced by a single dim stderr line. The SDK's default logger goes through
 * process.emitWarning, whose multi-line stack trace tears up the ai:chat Ink
 * UI mid-conversation. Full entries land here beside the pipeline failures
 * (filter with `jq 'select(.stage == "warning")'`); the stderr notice is
 * deduped per process so a warning that fires every turn prints only once.
 *
 * Installed at the process entry points — commands/command-runner.ts (every
 * CLI command) and service/run.ts (the notebook service) — NOT in models.ts,
 * because some call sites use providers directly and never load the profiles.
 */
export function routeAISDKWarningsToLog(): void {
  const noticed = new Set<string>()
  globalThis.AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }) => {
    const scope = [provider, model].filter(Boolean).join('/')
    for (const warning of warnings) {
      const message = scope ? `${scope}: ${formatAIWarning(warning)}` : formatAIWarning(warning)
      void logAIError({ source: 'ai-sdk', stage: 'warning', message })
      if (!noticed.has(message)) {
        noticed.add(message)
        console.warn(colors.dim(`AI SDK warning: ${message} (logged to ${AI_ERROR_LOG_DISPLAY})`))
      }
    }
  }
}
