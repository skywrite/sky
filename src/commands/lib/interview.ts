/**
 * Shared building blocks for AI-guided "new document" interview commands
 * (projects:new; decisions:new and ideas:new still carry local copies of
 * these, pending migration).
 */

import * as path from 'node:path'
import * as p from '@clack/prompts'
import { generateText } from 'ai'
import colors from 'picocolors'
import { z } from 'zod'
import type CommandService from '#commands/lib/core/CommandService.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'

// -----------------------------------------------------------------------------
// Notebook context
// -----------------------------------------------------------------------------

export interface NotebookContext {
  /** Delimited markdown of related documents, ready to embed in a prompt */
  notebookContext?: string
  /** Notebook-relative paths (no .md) to offer the AI as rel candidates */
  relCandidates: string[]
}

/**
 * Gather notebook context for an interview via ai:context:files.
 * Failures degrade to empty context — the interview continues without it.
 */
export async function gatherNotebookContext(
  tasks: CommandService,
  baseDir: string,
  description: string,
): Promise<NotebookContext> {
  try {
    const filesResult = await tasks.run<{ paths: string[] }>('ai:context:files', {
      _: ['ai:context:files', description],
      since: '90d',
    })

    if (filesResult.status !== 'success' || !filesResult.data?.paths?.length) {
      return { relCandidates: [] }
    }

    const store = await MarkdownStore.buildFromAll()

    const docs: Array<{ doc: Document; path: string }> = []
    for (const filePath of filesResult.data.paths) {
      try {
        const content = await readTextFile(filePath)
        docs.push({ doc: Document.fromMarkdown(content), path: filePath })
      } catch {
        // Skip unreadable files
      }
    }

    if (docs.length === 0) {
      return { relCandidates: [] }
    }

    const collection = DomainCollection.fromDocuments(docs, store)

    return {
      notebookContext: collection.toMarkdown({ relativeTo: baseDir, delimited: true }),
      // rel frontmatter values are notebook-relative paths without .md
      relCandidates: docs.map((d) => path.relative(baseDir, d.path).replace(/\.md$/, '')).slice(0, 12),
    }
  } catch {
    // Context gathering failed — continue without it
    return { relCandidates: [] }
  }
}

// -----------------------------------------------------------------------------
// Clarifier loop
// -----------------------------------------------------------------------------

// The "clear" variant is loose because the statement key varies per prompt
// ("decision", "idea", "statement"); the key itself is checked in the loop so
// a malformed reply degrades loudly instead of writing a half-empty document.
const clarifierResponseSchema = z.union([
  z.looseObject({ status: z.literal('clear'), summary: z.string() }),
  z.object({ status: z.literal('unclear'), question: z.string().min(1), reason: z.string() }),
])

type RoundOutcome =
  | { kind: 'clear'; statement: string; summary: string }
  | { kind: 'question'; question: string; reason: string }

export interface ClarifierLabels {
  /** Spinner text while the AI evaluates a round */
  thinking: string
  /** Spinner stop text when the AI judges the input clear */
  clear: string
  /** Bold prefix on the confirm message, e.g. "Project:" */
  confirm: string
  /** Prompt shown when the user rejects the AI's restatement */
  edit: string
}

export interface ClarifierLoopOptions {
  /** Absolute path to the .prompt.md file */
  promptFile: string
  /** Prompt filename, for render error reporting */
  promptName: string
  /** Build the render input for a round from the evolving input + history */
  buildInput: (currentInput: string, conversationHistory: string) => RenderInput
  /** JSON key holding the refined statement in a "clear" response */
  clearKey: string
  labels: ClarifierLabels
  maxRounds: number
  /** Source/stage recorded via logAIError when a round fails */
  errorSource: string
  errorStage: string
  spinner: ReturnType<typeof p.spinner>
  /** History label for the initial input; defaults to "User's initial description" */
  seedLabel?: string
}

export interface ClarifyResult {
  /** The final refined statement */
  statement: string
  /** Full conversation history (Q&A exchanges) */
  conversation: string
}

/**
 * Run an AI clarifier loop until the input is well-formed, the user cancels,
 * or maxRounds is reached (then the current input is returned as-is). AI
 * failures also degrade to the current input rather than aborting.
 * Returns null only when the user cancels.
 *
 * An empty initialInput runs in extract-or-ask mode: the first round has no
 * user statement, so the prompt must be written to either extract the answer
 * from its other inputs (returning "clear") or open with its own question.
 */
export async function runClarifierLoop(
  initialInput: string,
  opts: ClarifierLoopOptions,
): Promise<ClarifyResult | null> {
  const promptContent = await readTextFile(opts.promptFile)
  let currentInput = initialInput
  let conversationHistory = initialInput ? `${opts.seedLabel ?? "User's initial description"}: "${initialInput}"` : ''

  for (let round = 0; round < opts.maxRounds; round++) {
    opts.spinner.start(opts.labels.thinking)

    const { output: rendered } = renderPromptFile(
      promptContent,
      opts.promptName,
      opts.buildInput(currentInput, conversationHistory),
    )

    let outcome: RoundOutcome

    try {
      const result = await generateText({
        ...aiModel('reasoning'),
        prompt: rendered,
      })

      const parsed = clarifierResponseSchema.parse(extractJson(result.text))

      if (parsed.status === 'clear') {
        const value = (parsed as Record<string, unknown>)[opts.clearKey]
        if (typeof value !== 'string' || value.trim() === '') {
          throw new Error(`Clarifier "clear" response is missing "${opts.clearKey}"`)
        }
        outcome = { kind: 'clear', statement: value, summary: parsed.summary }
      } else {
        outcome = { kind: 'question', question: parsed.question, reason: parsed.reason }
      }
    } catch (err) {
      opts.spinner.stop('Clarification failed')
      await logAIError({ source: opts.errorSource, stage: opts.errorStage, message: (err as Error).message })
      return { statement: currentInput, conversation: conversationHistory }
    }

    if (outcome.kind === 'clear') {
      opts.spinner.stop(colors.green(opts.labels.clear))

      const confirmed = await p.confirm({
        message: `${colors.bold(opts.labels.confirm)} ${outcome.statement}\n\n  ${colors.dim(
          outcome.summary,
        )}\n\n  Is this correct?`,
        initialValue: true,
      })

      if (p.isCancel(confirmed)) {
        return null
      }

      if (confirmed) {
        return { statement: outcome.statement, conversation: conversationHistory }
      }

      const edited = await p.text({
        message: `${opts.labels.edit}\n`,
        initialValue: outcome.statement,
      })

      if (p.isCancel(edited)) {
        return null
      }

      currentInput = edited as string
      conversationHistory += `\nUser refined to: "${currentInput}"`
      continue
    }

    // Input is unclear - ask the clarifying question
    opts.spinner.stop(colors.dim(outcome.reason))

    const answer = await p.text({
      message: `${outcome.question}\n`,
      placeholder: 'Your answer...',
    })

    if (p.isCancel(answer)) {
      return null
    }

    conversationHistory += `\nAI asked: "${outcome.question}"\nUser answered: "${answer}"`
    currentInput = currentInput ? `${currentInput}\n\nClarification: ${answer}` : (answer as string)
  }

  // Max rounds reached - proceed with what we have
  return { statement: currentInput, conversation: conversationHistory }
}
