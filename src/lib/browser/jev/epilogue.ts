import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import type { ResolvedModel } from '#shared/ai/models.ts'
import ChatEngine, { type ChatEngineEvent, type ChatEngineOptions } from '#shared/models/Chat/ChatEngine/mod.ts'

// The ending Jev cannot write. Once the moves are done, a language model
// with the host's file tools checks what was downloaded against the goal,
// moves the files where the goal says, and writes the report in plain
// words. Each file is checked in a conversation of its own — four tax
// statements at once are more than a modest window holds — and a check
// only reads; the saving happens in one finishing turn with every verdict
// in hand. Network trouble is waited out, and if the model still cannot
// be reached, a file is reported as unchecked and the report is written by
// code, never a sunk run.

export interface EpilogueOptions {
  model: ResolvedModel
  goal: string
  /** The host's tools: read_file, save_file */
  tools: Record<string, unknown>
  /** What happened, one line each */
  history: string[]
  files: string[]
  /** How the moves ended */
  outcome: string
  when: string
  onEvent?: (event: ChatEngineEvent) => void
  abortSignal?: AbortSignal
  /** Test seam: the engine's scripted model */
  invokeModel?: ChatEngineOptions['invokeModel']
}

export interface FileVerdict {
  file: string
  /** The model's three lines, or why it could not look */
  verdict: string
  checked: boolean
}

export interface EpilogueResult {
  report: string
  verdicts: FileVerdict[]
  usage: { input: number; output: number }
}

export const CHECK_INSTRUCTIONS = `You check one downloaded file for a person. Open it with read_file, then answer in at most three short lines: what the document is, which year or period it covers, and whether it is what the task asked for (or an error page, a sign-in page, or the wrong year). No other text.`

export const FINISH_INSTRUCTIONS = `A browser agent finished working toward a task for a person, and each downloaded file has already been looked at. You finish the job. You have save_file.

Do, in order:
1. If the task names a place to save the files, move each file that is what the task asked for there with save_file. Never overwrite. Leave a file that was judged wrong or could not be checked where it is, and say so.
2. Reply in plain words, short lines: what was done, which files were saved with their full paths and what each one is, and what is missing, wrong, or could not be checked. Never say a step worked unless you saw it work.`

/** Network trouble is waited out: three tries, with longer pauses, before a turn counts as failed. */
const RETRY_WAITS_MS = [2_000, 5_000, 15_000]
const TRANSIENT =
  /ENOTFOUND|ECONNRESET|ECONNREFUSED|fetch failed|network|certificate|timed out|timeout|overloaded|529|503|502|429/i
const UNREADABLE = /capacity|context|too large|window/i

const isTransient = (error: unknown): boolean => TRANSIENT.test(error instanceof Error ? error.message : String(error))

async function withRetries<T>(run: () => Promise<T>, signal: AbortSignal | undefined, patience: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (!isTransient(error) || attempt >= patience || signal?.aborted) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAITS_MS[Math.min(attempt, RETRY_WAITS_MS.length - 1)]))
    }
  }
}

const engineFor = (options: EpilogueOptions, maxSteps: number) =>
  new ChatEngine({
    model: options.model,
    approvalHandler: async () => ({ approved: false, reason: 'The ending runs without approval rounds.' }),
    onEvent: options.onEvent,
    maxSteps,
    ...(options.invokeModel ? { invokeModel: options.invokeModel } : {}),
  })

const only = (tools: Record<string, unknown>, keep: (name: string) => boolean): Record<string, unknown> =>
  Object.fromEntries(Object.entries(tools).filter(([name]) => keep(name)))

/** One file, one conversation, reading only: the verdict, or why there is none. */
async function checkFile(
  options: EpilogueOptions,
  file: string,
  patience: number,
): Promise<{ verdict: FileVerdict; unreachable: boolean }> {
  const engine = engineFor(options, 6)
  engine.appendUserMessage(`The task: ${options.goal}\n\nThe file to check: ${file}`, options.when)
  try {
    const result = await withRetries(
      () =>
        engine.runTurn({
          abortSignal: options.abortSignal,
          instructions: [CHECK_INSTRUCTIONS],
          tools: only(options.tools, (name) => name === 'read_file'),
          toolApproval: {},
        }),
      options.abortSignal,
      patience,
    )
    const verdict = result.text.trim()
    return {
      verdict: { file, verdict: verdict || 'The model gave no verdict.', checked: verdict.length > 0 },
      unreachable: false,
    }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    if (UNREADABLE.test(why))
      return {
        verdict: {
          file,
          verdict: 'Could not be checked: the file is larger than the model can read at once.',
          checked: false,
        },
        unreachable: false,
      }
    return {
      verdict: { file, verdict: `Could not be checked: ${why.slice(0, 200)}`, checked: false },
      unreachable: isTransient(error),
    }
  }
}

/** The files still in the task folder, the ones a finishing turn can move. */
async function stillThere(files: string[]): Promise<string[]> {
  const checks = await Promise.all(
    files.map(async (file) => ((await stat(file).catch(() => null))?.isFile() ? file : null)),
  )
  return checks.filter((file): file is string => file !== null)
}

/** The report, written by the model after the moves, one file at a time. */
export async function runEpilogue(options: EpilogueOptions): Promise<EpilogueResult> {
  const usage = { input: 0, output: 0 }
  const verdicts: FileVerdict[] = []
  // A model that stayed unreachable through every retry gets one try per turn from then on.
  let patience = RETRY_WAITS_MS.length
  for (const file of options.files) {
    if (options.abortSignal?.aborted) break
    const { verdict, unreachable } = await checkFile(options, file, patience)
    verdicts.push(verdict)
    if (unreachable) patience = 0
  }

  const present = await stillThere(options.files)
  const engine = engineFor(options, 30)
  const message = [
    `The task: ${options.goal}`,
    '',
    `How the moves ended: ${options.outcome}`,
    '',
    options.files.length > 0
      ? `Files, and what each was found to be:\n${verdicts.map((v) => `- ${v.file}\n  ${v.verdict.split('\n').join('\n  ')}`).join('\n')}`
      : 'No files were downloaded.',
    '',
    present.length > 0
      ? `In the task folder right now, ready to be moved: ${present.map((file) => path.basename(file)).join(', ')}.`
      : 'Nothing is left in the task folder to move.',
    '',
    'What the agent did:',
    ...options.history.map((line) => `- ${line}`),
  ].join('\n')
  engine.appendUserMessage(message, options.when)
  try {
    const result = await withRetries(
      () =>
        engine.runTurn({
          abortSignal: options.abortSignal,
          instructions: [FINISH_INSTRUCTIONS],
          // The finishing turn moves files and writes; it never opens them again.
          tools: only(options.tools, (name) => name !== 'read_file'),
          toolApproval: {},
        }),
      options.abortSignal,
      patience,
    )
    usage.input += result.usage.input + result.usage.cacheRead
    usage.output += result.usage.output
    return { report: result.text, verdicts, usage }
  } catch (error) {
    // The model could not write the ending; the facts are written by code instead.
    const why = error instanceof Error ? error.message : String(error)
    const lines = [
      `The moves ended: ${options.outcome}`,
      '',
      ...(verdicts.length > 0
        ? [
            'Files, and what each was found to be:',
            ...verdicts.map((v) => `- ${v.file}\n  ${v.verdict.split('\n').join('\n  ')}`),
            '',
          ]
        : ['No files were downloaded.', '']),
      present.length > 0
        ? `Still in the task folder: ${present.map((file) => path.basename(file)).join(', ')}.`
        : 'Nothing is left in the task folder.',
      `The report could not be written by the model: ${why.slice(0, 200)}`,
    ]
    return { report: lines.join('\n'), verdicts, usage }
  }
}

/** A short line per file for the terminal. */
export function verdictLine(verdict: FileVerdict): string {
  return `${path.basename(verdict.file)}: ${verdict.verdict.split('\n')[0]}`
}
