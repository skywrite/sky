import * as path from 'node:path'
/**
 * Shared building blocks for AI-guided "new document" interview commands
 * (projects:new, decisions:new, ideas:new; streaks:new uses the round judge
 * inside its own multiline-capable shell).
 *
 * The single-round judge (runClarifierRound) is transport-free so the clack
 * loop here and the ai:chat tools can run the same prompts identically.
 */
import * as p from '@clack/prompts'
import { generateText } from 'ai'
import colors from 'picocolors'
import { z } from 'zod'
import type CommandService from '#commands/lib/core/CommandService.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { extractJson } from '#shared/ai/extractJson.ts'
import { aiModel } from '#shared/ai/models.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import ContextAssembler from '#shared/models/AI/ContextAssembler/mod.ts'
import { createRecencyTypeScorer } from '#shared/models/AI/ContextAssembler/scorers.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { toTimeRef } from '#shared/nbfs/mod.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { type RenderInput, renderPromptFile } from '#shared/prompts/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

// -----------------------------------------------------------------------------
// Notebook context
// -----------------------------------------------------------------------------

export interface NotebookContext {
  /** Delimited markdown of related documents, ready to embed in a prompt */
  notebookContext?: string
  /** Entity references (rel: vocabulary) to offer the AI as rel candidates */
  relCandidates: string[]
}

/**
 * Map a notebook-relative file path to the entity reference `rel:` frontmatter
 * uses — the vocabulary MarkdownStore.resolve understands: bare person/org
 * names, `projects/<name>`, `decisions/<slug>`, `ideas/<slug>`,
 * `streaks/<slug>`, `goals/<category>`, `places/<place-path>`, and
 * `YYYY-MM-DD/<subpath>` for time documents. Returns undefined for files with
 * no reference form (notes, journal, data). Callers should still verify with
 * store.canResolve — a ref that doesn't resolve is dead metadata.
 */
export function refForNotebookPath(relPath: string): string | undefined {
  const parts = relPath.split('/')
  const family = parts[0]
  const stem = parts[parts.length - 1].replace(/\.md$/, '')

  switch (family) {
    case 'people':
    case 'people-old':
    case 'orgs':
      // People and orgs resolve by name, which by convention is the file stem
      return stem || undefined
    case 'projects':
      // projects/<status>/<name>/... — the reference names the project itself
      return parts.length >= 3 ? `projects/${parts[2].replace(/\.md$/, '')}` : undefined
    case 'decisions':
    case 'ideas':
    case 'streaks':
      return relPath.endsWith('.md') ? `${family}/${stem}` : undefined
    case 'goals':
      return stem === 'personal' || stem === 'professional' ? `goals/${stem}` : undefined
    case 'places': {
      if (!relPath.endsWith('.md')) return undefined
      const rest = parts
        .slice(1)
        .join('/')
        .replace(/\.md$/, '')
        .replace(/^locations\//, '')
      return rest ? `places/${rest}` : undefined
    }
    case 'time': {
      // time/<layout path>/<subpath>.md → <yyyy-mm-dd>/<subpath>, any layout
      try {
        return toTimeRef(relPath).replace(/\.md$/, '')
      } catch {
        return undefined
      }
    }
    default:
      return undefined
  }
}

/**
 * Budget for the embedded related-document markdown. The query layer
 * deliberately returns everything a stated window matches (a date bound is
 * a floor, never a ceiling), so every consumer that embeds results owns its
 * own budget — without one, a broad statement can gather a
 * multi-million-token prompt the API rejects outright.
 */
const CONTEXT_MAX_TOKENS = 100_000

/**
 * Gather notebook context for an interview via ai:context:files, budgeted
 * through ContextAssembler: whole-doc admission by recency/type score until
 * CONTEXT_MAX_TOKENS. Rel candidates derive from the full pre-budget result
 * set. Failures degrade to empty context — the interview continues without
 * it.
 */
export async function gatherNotebookContext(
  tasks: CommandService,
  baseDir: string,
  description: string,
  today: PlainDate,
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
        docs.push({ doc: Document.fromMarkdown(await readTextFile(filePath)), path: filePath })
      } catch {
        // Skip unreadable files
      }
    }

    if (docs.length === 0) {
      return { relCandidates: [] }
    }

    const collection = DomainCollection.fromDocuments(docs, store, { depth: 1 })

    // Candidates are entity references, not file paths, and only refs the
    // store actually resolves are offered — so the AI can never pick a value
    // that would sit in rel: as a dead link. Derived from the full result
    // set, before budgeting — the budget bounds the embedded markdown, not
    // the rel vocabulary.
    const relCandidates = [
      ...new Set(
        docs
          .map((d) => refForNotebookPath(path.relative(baseDir, d.path)))
          .filter((ref): ref is string => ref !== undefined && store.canResolve(ref)),
      ),
    ].slice(0, 12)

    // Score and budget: whole-doc admission under the token budget, best
    // score first. The query's path list is field-major, not globally
    // newest-first, so a prefix walk would starve whole root fields — the
    // scorer decides instead.
    const assembler = ContextAssembler.from(collection, {
      scorer: createRecencyTypeScorer(today),
      maxTokens: CONTEXT_MAX_TOKENS,
    })

    return {
      notebookContext: assembler.toMarkdown({ relativeTo: baseDir, delimited: true }),
      relCandidates,
    }
  } catch {
    // Context gathering failed — continue without it
    return { relCandidates: [] }
  }
}

// -----------------------------------------------------------------------------
// Clarifier round (transport-free judge)
// -----------------------------------------------------------------------------

// The "clear" variant is loose because the statement key varies per prompt
// ("decision", "idea", "statement"); the key itself is checked after parsing so
// a malformed reply degrades loudly instead of writing a half-empty document.
const clarifierResponseSchema = z.union([
  z.looseObject({ status: z.literal('clear'), summary: z.string().optional() }),
  z.object({ status: z.literal('unclear'), question: z.string().min(1), reason: z.string() }),
])

export type ClarifierRound =
  | { kind: 'clear'; statement: string; summary?: string }
  | { kind: 'question'; question: string; reason: string }

export interface ClarifierRoundOptions {
  /** Contents of the .prompt.md file */
  promptContent: string
  /** Prompt filename, for render error reporting */
  promptName: string
  /** Render input for this round */
  input: RenderInput
  /** JSON key holding the refined statement in a "clear" response */
  clearKey: string
  /** Source/stage recorded via logAIError when the round fails */
  errorSource: string
  errorStage: string
}

export interface PromptJsonOptions<T> {
  /** Contents of the .prompt.md file */
  promptContent: string
  /** Prompt filename, for render error reporting */
  promptName: string
  input: RenderInput
  /** Contract the model's JSON reply must satisfy */
  schema: z.ZodType<T>
  /** Source/stage recorded via logAIError on failure */
  errorSource: string
  errorStage: string
}

/**
 * Render a prompt, run the model, and parse + validate its JSON reply.
 * Render warnings and all failures are logged via logAIError; failures
 * rethrow so each caller picks its own degrade policy.
 */
export async function runPromptJson<T>(opts: PromptJsonOptions<T>): Promise<T> {
  try {
    const { output: rendered, warnings } = renderPromptFile(opts.promptContent, opts.promptName, opts.input)

    if (warnings.length > 0) {
      // A namespace/field mismatch renders a hollow prompt section and the
      // model answers from it — surface it where AI failures are diagnosed
      await logAIError({
        source: opts.errorSource,
        stage: `${opts.errorStage}:render`,
        message: `${opts.promptName}: ${warnings.map((w) => w.message).join('; ')}`,
      })
    }

    const result = await generateText({
      ...aiModel('reasoning'),
      prompt: rendered,
    })

    return opts.schema.parse(extractJson(result.text))
  } catch (err) {
    await logAIError({ source: opts.errorSource, stage: opts.errorStage, message: (err as Error).message })
    throw err
  }
}

/**
 * One clarifier judgment: render the prompt, run the model, parse the
 * clear-or-question contract. Transport-free — the clack loop below and the
 * ai:chat tools share it, so both paths run the same prompts identically.
 *
 * Render warnings and all failures are logged via logAIError; failures
 * rethrow so each caller picks its own degrade policy.
 */
export async function runClarifierRound(opts: ClarifierRoundOptions): Promise<ClarifierRound> {
  const parsed = await runPromptJson({
    promptContent: opts.promptContent,
    promptName: opts.promptName,
    input: opts.input,
    schema: clarifierResponseSchema,
    errorSource: opts.errorSource,
    errorStage: opts.errorStage,
  })

  if (parsed.status === 'clear') {
    const value = (parsed as Record<string, unknown>)[opts.clearKey]
    if (typeof value !== 'string' || value.trim() === '') {
      const err = new Error(`Clarifier "clear" response is missing "${opts.clearKey}"`)
      await logAIError({ source: opts.errorSource, stage: opts.errorStage, message: err.message })
      throw err
    }
    return { kind: 'clear', statement: value, summary: parsed.summary }
  }

  return { kind: 'question', question: parsed.question, reason: parsed.reason }
}

// -----------------------------------------------------------------------------
// Clarifier loop (clack transport)
// -----------------------------------------------------------------------------

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
 * failures degrade to the current input — or, when there is no input yet,
 * fall back to asking the user directly rather than returning an empty
 * statement. Returns null only when the user cancels.
 *
 * An empty initialInput runs in extract-or-ask mode: the first round has no
 * user statement, so the prompt must be written to either extract the answer
 * from its other inputs (returning "clear") or open with its own question.
 */
export async function runClarifierLoop(
  initialInput: string,
  opts: ClarifierLoopOptions,
): Promise<ClarifyResult | null> {
  const promptContent = await readPromptFile(opts.promptFile)
  let currentInput = initialInput
  let conversationHistory = initialInput ? `${opts.seedLabel ?? "User's initial description"}: "${initialInput}"` : ''

  for (let round = 0; round < opts.maxRounds; round++) {
    opts.spinner.start(opts.labels.thinking)

    let outcome: ClarifierRound

    try {
      outcome = await runClarifierRound({
        promptContent,
        promptName: opts.promptName,
        input: opts.buildInput(currentInput, conversationHistory),
        clearKey: opts.clearKey,
        errorSource: opts.errorSource,
        errorStage: opts.errorStage,
      })
    } catch {
      // Already logged by the round. With input in hand, degrade to it; in
      // extract-or-ask mode there is nothing to degrade to — ask the user
      // directly rather than handing an empty statement downstream.
      if (currentInput.trim()) {
        opts.spinner.stop('Clarification failed — keeping your description as written')
        return { statement: currentInput, conversation: conversationHistory }
      }

      opts.spinner.stop('Clarification failed')

      const manual = await p.text({
        message: `${opts.labels.edit}\n`,
        validate: (value) => {
          if (!value.trim()) return 'Please provide an answer'
        },
      })

      if (p.isCancel(manual)) {
        return null
      }

      return { statement: (manual as string).trim(), conversation: conversationHistory }
    }

    if (outcome.kind === 'clear') {
      opts.spinner.stop(colors.green(opts.labels.clear))

      const summaryLine = outcome.summary ? `\n\n  ${colors.dim(outcome.summary)}` : ''
      const confirmed = await p.confirm({
        message: `${colors.bold(opts.labels.confirm)} ${outcome.statement}${summaryLine}\n\n  Is this correct?`,
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
      // Record what was rejected, not just the replacement — later rounds
      // shouldn't re-propose a statement the user already turned down
      conversationHistory += `\nAI proposed: "${outcome.statement}"\nUser revised to: "${currentInput}"`
      continue
    }

    // Input is unclear - ask the clarifying question
    opts.spinner.stop(colors.dim(outcome.reason))

    const answer = await p.text({
      message: `${outcome.question}\n`,
      placeholder: 'Your answer...',
      validate: (value) => {
        if (!value.trim()) return 'An empty answer spends a round — answer, or press ESC to cancel'
      },
    })

    if (p.isCancel(answer)) {
      return null
    }

    conversationHistory += `\nAI asked: "${outcome.question}"\nUser answered: "${answer}"`
    currentInput = currentInput ? `${currentInput}\n\nClarification: ${answer}` : (answer as string)
  }

  // Max rounds reached - proceed with what we have
  p.log.message(colors.dim('Max clarification rounds reached — proceeding with the description as it stands'))
  return { statement: currentInput, conversation: conversationHistory }
}
