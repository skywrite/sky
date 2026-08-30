/**
 * The ask_notebook delegate behind a voice session — a headless,
 * stateless slice of ai:chat's pipeline: select documents for one
 * question through the tuned ai:context:files producer, read them under a
 * byte budget, and answer with the reasoning model. The realtime voice
 * model narrates the wait, so this call is allowed to take its time. Both
 * voice transports run it: ai:voice in its own process, the web page
 * through the service.
 */

import { generateText } from 'ai'
import type { RealtimeFunctionTool } from 'openai/resources/realtime/realtime'
import type { CommandService } from '#commands/mod.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { toTimeRef } from '#shared/nbfs/mod.ts'
import truncate from '#shared/strings/truncate.ts'

/** Total notebook text handed to the delegate model (~40k tokens). */
const MAX_CONTEXT_CHARS = 160_000
/** Per-document cap so one giant file cannot crowd out the rest. */
const MAX_FILE_CHARS = 24_000

export interface NotebookAnswer {
  answer: string
  /** Documents actually included in the delegate's context. */
  paths: string[]
}

/**
 * The realtime-session tool definition. The description doubles as the
 * voice model's operating manual: it carries the narration guidance the
 * Realtime API expects tool descriptions to include.
 */
export const ASK_NOTEBOOK = 'ask_notebook'

export const ASK_NOTEBOOK_TOOL: RealtimeFunctionTool = {
  type: 'function',
  name: ASK_NOTEBOOK,
  description:
    "Research the user's personal notebook and answer one question. Use it for ANY question touching " +
    "the user's life, work, people, meetings, plans, journal, decisions, or history — never answer those " +
    'from memory. It is slow (ten to thirty seconds): right before calling, tell the user in a few words ' +
    'what you are checking, and stay conversational while it runs. The result is a spoken-ready answer; ' +
    'relay it faithfully.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          "A complete, self-contained question in the user's words, with any context from earlier in the " +
          'conversation folded in — the researcher sees nothing but this string.',
      },
    },
    required: ['question'],
  },
}

/**
 * Answer one question from the notebook: ai:context:files picks the
 * documents, the reasoning model reads them and answers for the ear.
 */
export async function askNotebook(
  tasks: CommandService,
  model: ResolvedModel,
  systemPrompt: string,
  question: string,
): Promise<NotebookAnswer> {
  const selection = await tasks.run('ai:context:files', {
    _: ['ai:context:files', question],
    server: true,
  })
  if (selection.status !== 'success') {
    return { answer: `The notebook search failed: ${selection.message ?? 'ai:context:files error'}.`, paths: [] }
  }

  const paths: string[] = selection.data?.paths ?? []
  if (paths.length === 0) {
    return { answer: 'The notebook search returned no documents for that question.', paths: [] }
  }

  const { block, included } = await readContextBlock(paths)
  if (included.length === 0) {
    return { answer: 'The notebook search found documents, but none of them could be read.', paths: [] }
  }

  const { text } = await generateText({
    ...model,
    system: systemPrompt,
    prompt: `# Notebook context\n\n${block}\n\n# Question\n\n${question}`,
  })

  return { answer: text.trim(), paths: included }
}

const KIND_LABELS: Record<string, string> = {
  journal: 'Journal',
  meetings: 'Meeting',
  messages: 'Message',
  'ai-chats': 'AI chat',
  notes: 'Note',
  events: 'Event',
  decisions: 'Decision',
  ideas: 'Idea',
}

/**
 * Human-readable heading for a notebook document, derived from its path:
 * kind and calendar date instead of cryptic path segments. The delegate
 * model attributes facts to dates far more reliably when every document
 * announces its own — raw paths like `time/2026/W32/08-05/...` got
 * separate days fused into one misdated narrative.
 */
export function describeNotebookPath(path: string): string {
  const parts = path.split('/')
  const file = (parts.at(-1) ?? '').replace(/\.md$/, '')

  const peopleIdx = parts.indexOf('people')
  if (peopleIdx >= 0) return `Person profile — ${file}`

  // Any time-tree layout: toTimeRef canonicalizes the path to its date,
  // including v1.1's year-boundary artifacts (12/29-04 holding 01-02).
  const timeIdx = parts.indexOf('time')
  if (timeIdx >= 0) {
    try {
      const ref = toTimeRef(parts.slice(timeIdx).join('/'))
      const [ymd, ...sub] = ref.split('/')
      const kindDir = sub[0] === 'actions' ? (sub[1] ?? '') : (sub[0] ?? '')
      const kind = KIND_LABELS[kindDir] ?? (kindDir ? kindDir.charAt(0).toUpperCase() + kindDir.slice(1) : 'Document')
      return `${kind} — ${ymd} — ${file}`
    } catch {
      // Not a day path (year-level docs, malformed) — fall through to raw.
    }
  }

  return path
}

/** Read selected documents into one context block, under the byte budget. */
async function readContextBlock(paths: string[]): Promise<{ block: string; included: string[] }> {
  const blocks: string[] = []
  const included: string[] = []
  let budget = MAX_CONTEXT_CHARS

  for (const path of paths) {
    if (budget <= 0) break
    let content: string
    try {
      content = await readTextFile(path)
    } catch {
      continue // vanished or unreadable — the notebook is edited live
    }
    const clamped = truncate(content, Math.min(MAX_FILE_CHARS, budget))
    blocks.push(`## ${describeNotebookPath(path)}\n\n${clamped}`)
    included.push(path)
    budget -= clamped.length
  }

  return { block: blocks.join('\n\n'), included }
}
