import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { jsonSchema, tool } from 'ai'
import type { ResolvedModel } from '#shared/ai/models.ts'
import ChatEngine, { type ChatEngineEvent, type TurnCut, type TurnResult } from '#shared/models/Chat/ChatEngine/mod.ts'
import { attachBrowserDriver, closeTab } from '../mcp/browserDriver.ts'
import { browserToolsFrom } from '../mcp/tools.ts'
import { browserTaskInstructions } from './prompt.ts'

// One browser task: Sky's chat engine drives the browser server's tools
// toward a plain-language objective. The host — a terminal today — supplies
// the model, any extra tools, and the moment the person is needed.

export const WAIT_FOR_PERSON_TOOL = 'wait_for_person'

/** Steps per task. Each look or move is one; a document run needs dozens. */
const DEFAULT_MAX_STEPS = 80

export interface BrowserTaskOptions {
  objective: string
  model: ResolvedModel
  /** The task's folder; the browser server logs here and files land in files/ */
  taskDir: string
  filesDir: string
  /** The model's clock, a notebook datetime: `YYYY-MM-DD HH:MM` */
  when: string
  /** The host's tools beside the browser: read_file, save_file … */
  tools?: Record<string, unknown>
  /**
   * The person is needed in the browser window. Resolves true once they say
   * they are done and Sky may look again, false when they stop the task.
   */
  onNeedsYou: (message: string) => Promise<boolean>
  onEvent?: (event: ChatEngineEvent) => void
  maxSteps?: number
  abortSignal?: AbortSignal
  headless?: boolean
  /** Where Sky's browser lives; the default is ~/.sky/browser */
  browserRoot?: string
}

export interface BrowserTaskResult {
  /** The model's closing words: what it did, what it saved, what is missing */
  report: string
  cutShort?: TurnCut
  stopped?: boolean
  toolRecords: TurnResult['toolRecords']
  usage: TurnResult['usage']
  /** What sits in files/ when the task ends: downloads, screenshots */
  files: string[]
  /** The browser driver and the tool names it offered the model */
  server?: string
  toolNames: string[]
}

export async function runBrowserTask(options: BrowserTaskOptions): Promise<BrowserTaskResult> {
  const { client, driver } = await attachBrowserDriver({ headless: options.headless, root: options.browserRoot })
  let finished = false
  try {
    const definitions = await client.listTools()
    const browserTools = browserToolsFrom(client, definitions, {
      downloads: { from: driver.downloadsDir, to: options.filesDir },
    })
    const waitForPerson = tool({
      description:
        'Stop and ask the person to do something in the browser window that only they can do: sign in, enter a code, pass a verification, choose between accounts, or confirm something you are about to submit. Give a short plain instruction. Returns once they say they are done; look at the page again before acting.',
      inputSchema: jsonSchema<{ message: string }>({
        type: 'object',
        properties: { message: { type: 'string', description: 'What the person should do, in plain words' } },
        required: ['message'],
      }),
      execute: async ({ message }) => {
        const continued = await options.onNeedsYou(message)
        return continued
          ? { continued: true, note: 'The person says they are done. Take a fresh snapshot before acting.' }
          : { continued: false, note: 'The person stopped the task. Report what was done and what remains.' }
      },
    })
    const tools = { ...browserTools, [WAIT_FOR_PERSON_TOOL]: waitForPerson, ...options.tools }

    const engine = new ChatEngine({
      model: options.model,
      approvalHandler: async () => ({ approved: false, reason: 'Browser tasks run without approval rounds.' }),
      onEvent: options.onEvent,
      maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    })
    engine.appendUserMessage(options.objective, options.when)
    const result = await engine.runTurn({
      abortSignal: options.abortSignal,
      instructions: [browserTaskInstructions({ objective: options.objective, filesDir: options.filesDir })],
      tools,
      toolApproval: {},
    })
    // The server writes its own diagnostics beside the downloads; those are not the person's files.
    const files = (await readdir(options.filesDir))
      .filter((name) => !/^console-.*\.log$/.test(name))
      .sort()
      .map((name) => path.join(options.filesDir, name))
    finished = !result.stopped && !result.cutShort
    return {
      report: result.text,
      cutShort: result.cutShort,
      stopped: result.stopped,
      toolRecords: result.toolRecords,
      usage: result.usage,
      files,
      server: client.serverInfo ? `${client.serverInfo.name} ${client.serverInfo.version}` : undefined,
      toolNames: Object.keys(tools),
    }
  } finally {
    // A finished task's tab closes; a stopped or cut-short one stays for the person to see.
    if (finished) await closeTab(client)
    await client.close() // the driver and its window stay up
  }
}
