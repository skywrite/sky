import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { jsonSchema, tool } from 'ai'
import type { ResolvedModel } from '#shared/ai/models.ts'
import ChatEngine, { type ChatEngineEvent, type TurnCut, type TurnResult } from '#shared/models/Chat/ChatEngine/mod.ts'
import { attachBrowserDriver, closeTab } from '../mcp/browserDriver.ts'
import { BROWSER_TOOL_NAMES, browserToolsFrom } from '../mcp/tools.ts'
import { launchPrivateBrowser } from '../signIn/launch.ts'
import type { PrivateBrowserClient } from '../signIn/run.ts'
import { browserTaskInstructions } from './prompt.ts'
import type { BrowserUploads } from './uploads.ts'

// One browser task: Sky's chat engine drives the browser server's tools
// toward a plain-language objective. The host — a terminal today — supplies
// the model, any extra tools, and the moment the person is needed.

export const WAIT_FOR_PERSON_TOOL = 'wait_for_person'

/** Steps per task. Each look or move is one; a document run needs dozens. */
const DEFAULT_MAX_STEPS = 80

export interface BrowserTaskOptions {
  objective: string
  uploads?: BrowserUploads
  model: ResolvedModel
  /** The task's folder; the browser server logs here and files land in files/ */
  taskDir: string
  filesDir: string
  /** The model's clock, a notebook datetime: `YYYY-MM-DD HH:MM` */
  when: string
  /** The host's tools beside the browser: read_file, save_file … */
  tools?: Record<string, unknown> | ((browser: Pick<PrivateBrowserClient, 'callTool'>) => Record<string, unknown>)
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
  /** Configured password managers use a private worker with a persistent Sky browser profile. */
  privateSignIn?: boolean
  /** Keep an existing-Brave task in its own window without focusing it for input. */
  background?: boolean
  /** Trusted host/test connection; never supplied by a model tool. The task closes it on exit. */
  browser?: PrivateBrowserClient
}

export interface BrowserTaskResult {
  signInFailure?: string
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
  const privateBrowser = !!(options.privateSignIn || options.uploads || options.browser)
  const connection = options.browser
    ? { client: options.browser, driver: undefined }
    : privateBrowser
      ? {
          client: await launchPrivateBrowser(
            {
              objective: options.objective,
              filesDir: options.filesDir,
              headless: options.headless,
              uploads: options.uploads,
              background: options.background,
            },
            options.abortSignal,
          ),
          driver: undefined,
        }
      : await attachBrowserDriver({ headless: options.headless, root: options.browserRoot })
  const { client, driver } = connection
  let finished = false
  let signInFailure: string | undefined
  try {
    const definitions = await client.listTools()
    const browserTools = browserToolsFrom(client, definitions, {
      downloads: driver ? { from: driver.downloadsDir, to: options.filesDir } : undefined,
      allow: privateBrowser ? [...BROWSER_TOOL_NAMES, 'sign_in'] : BROWSER_TOOL_NAMES,
      timeoutMs: privateBrowser ? 300000 : undefined,
      onSignInFailure: (message) => {
        signInFailure = message
      },
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
        if (signInFailure) return { continued: false, note: signInFailure }
        const continued = await options.onNeedsYou(message)
        return continued
          ? { continued: true, note: 'The person says they are done. Take a fresh snapshot before acting.' }
          : { continued: false, note: 'The person stopped the task. Report what was done and what remains.' }
      },
    })
    const hostTools = typeof options.tools === 'function' ? options.tools(client) : options.tools
    const tools = { ...browserTools, [WAIT_FOR_PERSON_TOOL]: waitForPerson, ...hostTools }

    const engine = new ChatEngine({
      model: options.model,
      approvalHandler: async () => ({ approved: false, reason: 'Browser tasks run without approval rounds.' }),
      onEvent: options.onEvent,
      maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    })
    engine.appendUserMessage(options.objective, options.when)
    const result = await engine.runTurn({
      abortSignal: options.abortSignal,
      shouldYield: () => !!signInFailure,
      instructions: [
        browserTaskInstructions({
          objective: options.objective,
          filesDir: options.filesDir,
          privateSignIn: privateBrowser,
          uploads: options.uploads,
        }),
      ],
      tools,
      toolApproval: {},
    })
    // The server writes its own diagnostics beside the downloads; those are not the person's files.
    const files = (await readdir(options.filesDir))
      .filter((name) => !/^console-.*\.log$/.test(name))
      .sort()
      .map((name) => path.join(options.filesDir, name))
    finished = !result.stopped && !result.cutShort && !signInFailure
    return {
      report: signInFailure ?? result.text,
      signInFailure,
      cutShort: result.cutShort,
      stopped: result.stopped,
      toolRecords: result.toolRecords,
      usage: result.usage,
      files,
      server: client.serverInfo ? `${client.serverInfo.name} ${client.serverInfo.version}` : undefined,
      toolNames: Object.keys(tools),
    }
  } finally {
    // The private worker releases the browser while retaining its profile and sign-ins.
    if (finished && !privateBrowser) await closeTab(client)
    await client.close()
  }
}
