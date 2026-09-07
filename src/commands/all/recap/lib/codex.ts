import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import { createInterface } from 'node:readline'
import { walk } from '#shared/fs/mod.ts'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { commitSubject, type CodingSession, type ScanWindow } from './codingSession.ts'
import { parseInstant } from './parseInstant.ts'

const PROMPT_TEXT_CAP = 1_500
const PROMPT_LOG_MAX = 400
const FINAL_ASSISTANT_CAP = 5_000
const COMMAND_LOG_MAX = 40
const COMMAND_TEXT_CAP = 500

type Json = Record<string, unknown>
type Prompt = { instant: Instant; text: string; source: string }

function object(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(object)
    .filter((part) => ['text', 'Text', 'input_text', 'output_text'].includes(text(part.type)))
    .map((part) => text(part.text))
    .join('\n')
}

function typedText(value: string): string {
  const trimmed = value.trim()
  if (
    /^(?:# AGENTS\.md instructions|<(?:environment_context|INSTRUCTIONS|turn_aborted|subagent_notification|system-reminder)>)/.test(
      trimmed,
    )
  )
    return ''
  return trimmed
}

function delegated(source: unknown): boolean {
  return text(source).startsWith('subagent') || 'subagent' in object(source)
}

function commandText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value) || !value.every((part) => typeof part === 'string')) return ''
  // Shell wrappers record argv; the script after -c/-lc is the useful trail.
  const script = value.findIndex((part) => /^-[a-z]*c$/.test(part))
  return script >= 0
    ? (value[script + 1] ?? '')
    : value.map((part) => (/\s|["'\\]/.test(part) ? JSON.stringify(part) : part)).join(' ')
}

function toolName(value: unknown): string {
  return text(value).split('.').at(-1) ?? ''
}

function parseObject(value: unknown): Json {
  if (typeof value !== 'string') return object(value)
  try {
    return object(JSON.parse(value))
  } catch {
    return {}
  }
}

/** Mirrored user events count once; repeated prompts from the same stream still count. */
function mergePrompts(primary: Prompt[], secondary: Prompt[]): Prompt[] {
  const matched = new Set<number>()
  const merged = [...primary]
  for (const prompt of secondary) {
    const index = primary.findIndex(
      (other, i) =>
        !matched.has(i) &&
        other.text === prompt.text &&
        Math.abs(other.instant.epochMilliseconds - prompt.instant.epochMilliseconds) < 2_000,
    )
    if (index >= 0) {
      matched.add(index)
      if (Instant.compare(prompt.instant, merged[index].instant) < 0) merged[index] = prompt
    } else merged.push(prompt)
  }
  return merged.sort((a, b) => Instant.compare(a.instant, b.instant))
}

async function scanFile(file: string, window: ScanWindow): Promise<CodingSession | null> {
  let sessionId = ''
  let cwd = ''
  let turnCwd = ''
  let forkStart: Instant | null = null
  let start: Instant | null = null
  let end: Instant | null = null
  let finalAssistant = ''
  let lastAssistant = ''
  const prompts: Prompt[] = []
  const fallbackPrompts: Prompt[] = []
  const files = new Set<string>()
  const commands = new Set<string>()
  const commits = new Set<string>()
  const calls = new Map<string, { name: string; input: Json; raw: string; cwd: string }>()

  function addFile(value: unknown, workingDir = turnCwd || cwd): void {
    const filePath = text(value)
    if (filePath) files.add(path.isAbsolute(filePath) ? filePath : path.join(workingDir, filePath))
  }

  function addCommand(command: string, successful: boolean): void {
    if (!command) return
    if (commands.size < COMMAND_LOG_MAX) commands.add(command.replace(/\s+/g, ' ').slice(0, COMMAND_TEXT_CAP))
    const subject = successful ? commitSubject(command) : null
    if (subject) commits.add(subject)
  }

  function addPatch(patch: string, workingDir: string): void {
    for (const match of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) {
      addFile(match[1].trim(), workingDir)
    }
  }

  function addAssistant(value: string, phase: unknown): void {
    const message = value.trim().slice(0, FINAL_ASSISTANT_CAP)
    if (!message) return
    lastAssistant = message
    if (phase === 'final_answer' || phase === undefined || phase === null) finalAssistant = message
  }

  const stream = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const raw of lines) {
      const line = parseObject(raw)
      const payload = object(line.payload)
      if (line.type === 'session_meta') {
        if (delegated(payload.source) || delegated(payload.thread_source) || payload.source === 'exec') return null
        sessionId ||= text(payload.id) || text(payload.session_id)
        cwd ||= text(payload.cwd)
        turnCwd ||= cwd
        if (payload.forked_from_id) forkStart = parseInstant(payload.timestamp)
        continue
      }
      if (line.type === 'turn_context') {
        turnCwd = text(payload.cwd) || turnCwd
        cwd ||= turnCwd
        continue
      }

      const instant = parseInstant(line.timestamp)
      if (!instant || (forkStart && Instant.compare(instant, forkStart) < 0)) continue
      const inWindow = Instant.compare(instant, window.start) >= 0 && Instant.compare(instant, window.end) < 0
      let activity = false

      if (line.type === 'event_msg') {
        const item = object(payload.item)
        if (payload.type === 'user_message' || (payload.type === 'item_completed' && item.type === 'UserMessage')) {
          const message = typedText(payload.type === 'user_message' ? text(payload.message) : contentText(item.content))
          if (message) prompts.push({ instant, text: message, source: text(payload.type) })
          activity = !!message
        } else if (inWindow && payload.type === 'item_completed') {
          switch (item.type) {
            case 'AgentMessage':
              addAssistant(contentText(item.content), item.phase)
              activity = true
              break
            case 'CommandExecution':
              addCommand(commandText(item.command), item.status === 'completed' && item.exit_code === 0)
              activity = true
              break
            case 'FileChange':
              if (item.status === 'completed') {
                for (const [name, change] of Object.entries(object(item.changes))) {
                  addFile(name)
                  addFile(object(change).move_path)
                }
                activity = true
              }
              break
          }
        } else if (inWindow && payload.type === 'agent_message') {
          addAssistant(text(payload.message), payload.phase)
          activity = true
        } else if (inWindow && payload.type === 'task_complete' && payload.last_agent_message) {
          addAssistant(text(payload.last_agent_message), 'final_answer')
          activity = true
        }
      }

      if (line.type === 'response_item') {
        if (payload.type === 'message' && payload.role === 'user') {
          const kinds = object(payload.internal_chat_message_metadata_passthrough).content_item_kinds
          const content =
            Array.isArray(kinds) && Array.isArray(payload.content)
              ? payload.content.filter((_, index) => kinds[index] === 'user.text')
              : payload.content
          const message = typedText(contentText(content))
          if (message) fallbackPrompts.push({ instant, text: message, source: 'response' })
        } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
          const name = toolName(payload.name)
          if (['shell', 'shell_command', 'exec_command', 'apply_patch'].includes(name)) {
            const input = parseObject(payload.arguments ?? payload.input)
            calls.set(text(payload.call_id), {
              name,
              input,
              raw: text(payload.input),
              cwd: text(input.workdir) || turnCwd || cwd,
            })
          }
          activity = true
        } else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
          const call = calls.get(text(payload.call_id))
          calls.delete(text(payload.call_id))
          if (call && inWindow) {
            const output = text(payload.output)
            const result = parseObject(payload.output)
            const exitCode = result.exit_code ?? object(result.metadata).exit_code
            const successful =
              exitCode === 0 ||
              /(?:Process exited with code 0|Exit code: 0|Success\. Updated the following files:)/.test(output)
            if (call.name === 'apply_patch') {
              if (successful) addPatch(call.raw || text(call.input.patch), call.cwd)
            } else {
              const command = commandText(call.input.cmd ?? call.input.command)
              addCommand(command, successful)
              if (successful) addPatch(command, call.cwd)
            }
          }
          activity = true
        } else if (inWindow && payload.type === 'message' && payload.role === 'assistant') {
          addAssistant(contentText(payload.content), payload.phase)
          activity = true
        }
      }

      if (activity && inWindow) {
        if (!start || Instant.compare(instant, start) < 0) start = instant
        if (!end || Instant.compare(instant, end) > 0) end = instant
      }
    }
  } catch {
    return null
  } finally {
    lines.close()
    stream.destroy()
  }

  // Older rollouts have user_message, newer ones have completed UserMessage.
  // Response messages are a fallback only: they also carry injected context.
  const typed = (
    prompts.length
      ? mergePrompts(
          prompts.filter((p) => p.source === 'item_completed'),
          prompts.filter((p) => p.source === 'user_message'),
        )
      : fallbackPrompts
  ).filter(
    (prompt) => Instant.compare(prompt.instant, window.start) >= 0 && Instant.compare(prompt.instant, window.end) < 0,
  )
  for (const prompt of typed) {
    if (!start || Instant.compare(prompt.instant, start) < 0) start = prompt.instant
    if (!end || Instant.compare(prompt.instant, end) > 0) end = prompt.instant
  }
  if (!start || !end || (!typed.length && !files.size && !commands.size && !finalAssistant)) return null

  return {
    sessionId: sessionId || path.basename(file, '.jsonl'),
    cwd,
    repo: cwd ? path.basename(cwd) : 'Codex',
    start,
    end,
    prompts: typed.length,
    filesTouched: files.size,
    gist: typed[0]?.text.replace(/\s+/g, ' ').slice(0, 100) ?? '',
    promptLog: typed
      .slice(0, PROMPT_LOG_MAX)
      .map(({ instant, text }) => ({ instant, text: text.slice(0, PROMPT_TEXT_CAP) })),
    finalAssistant: finalAssistant || lastAssistant,
    files: [...files],
    commandLog: [...commands],
    commits: [...commits],
  }
}

/** Scan every rollout: an old date folder can hold a session resumed today. */
export default async function scanCodexSessions(codexDir: string, window: ScanWindow): Promise<CodingSession[]> {
  const sessions = new Map<string, CodingSession>()
  for (const area of ['sessions', 'archived_sessions']) {
    for await (const entry of walk(path.join(codexDir, area), { includeDirs: false, exts: ['.jsonl'] })) {
      try {
        if ((await stat(entry.path)).mtimeMs < window.start.epochMilliseconds) continue
      } catch {
        continue
      }
      const session = await scanFile(entry.path, window)
      if (!session) continue
      // Archiving can briefly leave both paths visible. Keep one session.
      const existing = sessions.get(session.sessionId)
      if (!existing || Instant.compare(session.end, existing.end) > 0) sessions.set(session.sessionId, session)
    }
  }
  return [...sessions.values()].sort((a, b) => Instant.compare(a.start, b.start))
}
