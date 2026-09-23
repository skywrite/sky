import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import type { Page } from 'playwright'
import { NoBrowserError, findChromiumBrowser, withPersistentBrowser } from '#lib/browser/persistentContext.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { exists } from '#shared/fs/mod.ts'
import { logger } from '#shared/log.ts'
import { GOOGLE_CLOUD_SETUP } from '../setup.ts'
import { loadProjectClient } from '../tokens.ts'
import { consent } from './consent.ts'
import { CONSOLE_STEPS, type ConsoleStep, type StepContext } from './consoleSteps.ts'
import { captureStepDiagnostics } from './diagnostics.ts'
import { StepFailed } from './page.ts'
import {
  SETUP_PROFILE_DIR,
  SETUP_RESUME_FILE,
  type SetupResume,
  clearSetupLeftovers,
  emptyResume,
  readResume,
  rememberProject,
  writeResume,
} from './resume.ts'
import { signIn } from './signIn.ts'
import {
  type CloudSetupState,
  type SetupPhaseKey,
  failed,
  finished,
  initialState,
  withNeedsYou,
  withPhase,
  withoutNeedsYou,
} from './state.ts'
import { tidyProjects } from './tidy.ts'

// One run of the automated setup: a window the person signs in to, the
// console steps done for them, then Google's permission page. The run
// reports itself as a checklist (state.ts); where it cannot act it shows the
// written step and waits for Continue. A stopped run resumes: the profile
// keeps the sign-in, the resume file keeps the project.

const log = logger('google', 'setup')

export interface CloudSetupRun {
  readonly id: string
  state(): CloudSetupState
  /** Called on every change; returns the unsubscribe */
  onChange(listener: (state: CloudSetupState) => void): () => void
  /** The person did the waiting step by hand — look again */
  continue(): void
  cancel(): void
  /** Settles when the run ends, with its final state; never rejects */
  readonly finished: Promise<CloudSetupState>
}

export interface CloudSetupOptions {
  secrets: SecretsProvider
  /** The person agreed to Google Cloud's terms and the API User Data Policy on Sky's start screen. */
  agreedToTerms: true
  profileDir?: string
  resumeFile?: string
  ledgerFile?: string
  /** Only the sweep: sign in, then shut down the leftovers — no project is made */
  tidyOnly?: boolean
  /** The moving parts — tests script them */
  engine?: SetupEngine
}

/** A window with a page in it; `onClose` runs when the person closes the window. */
export interface SetupWindow {
  page: Page
  onClose: (handler: () => void) => void
  close: () => Promise<void>
}

/** What a run drives: the window, the console steps, and the two steps the person is part of. */
export interface SetupEngine {
  open: (profileDir: string, fn: (window: SetupWindow) => Promise<void>) => Promise<void>
  signIn: typeof signIn
  steps: readonly ConsoleStep[]
  consent: typeof consent
  tidy: typeof tidyProjects
}

const LIVE_ENGINE: SetupEngine = {
  open: async (profileDir, fn) =>
    withPersistentBrowser(
      { profileDir, headless: false, takeover: true, ...(await setupBrowserPath()) },
      async (_session, browser) => {
        const page = browser.pages()[0] ?? (await browser.newPage())
        page.setDefaultTimeout(30_000)
        await fn({
          page,
          onClose: (handler) => browser.once('close', handler),
          close: () => browser.close().catch(() => undefined),
        })
      },
    ),
  signIn,
  steps: CONSOLE_STEPS,
  consent,
  tidy: tidyProjects,
}

class RunAborted extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunAborted'
  }
}

/**
 * The browser the setup drives: the first installed Chromium-family browser
 * — current, and the one Google already trusts to sign in — else
 * Playwright's own Chromium when it is installed. SKY_BROWSER_EXECUTABLE
 * names one outright.
 */
async function setupBrowserPath(): Promise<{ executablePath?: string }> {
  const named = process.env.SKY_BROWSER_EXECUTABLE
  if (named && (await exists(named))) return { executablePath: named }
  const installed = await findChromiumBrowser()
  if (installed) return { executablePath: installed }
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
  const builds = await readdir(cache).catch(() => [] as string[])
  const chromiums = builds
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
  for (const build of chromiums) {
    const binary = path.join(cache, build, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
    if (await exists(binary)) return { executablePath: binary }
  }
  return {}
}

export const WINDOW_CLOSED_MESSAGE =
  'The window closed before the setup finished. Connect again to pick up where it stopped.'

/** Which console steps a resume already has — the client only counts with its pair in the keychain. */
function alreadyDone(resume: SetupResume): Set<SetupPhaseKey> {
  return new Set(resume.done)
}

export function startCloudSetup(options: CloudSetupOptions): CloudSetupRun {
  const id = randomUUID()
  const profileDir = options.profileDir ?? SETUP_PROFILE_DIR
  const resumeFile = options.resumeFile ?? SETUP_RESUME_FILE
  const listeners = new Set<(state: CloudSetupState) => void>()
  let state = initialState(options.tidyOnly ? ['signin', 'tidy'] : undefined)
  const set = (next: CloudSetupState) => {
    state = next
    for (const listener of listeners) listener(state)
  }

  // Cancel and a closed window both end the run from outside a step.
  let abort: (err: RunAborted) => void = () => undefined
  const aborted = new Promise<never>((_, reject) => {
    abort = reject
  })
  aborted.catch(() => undefined)
  /** Work that an abort can cut short; the work's own late failure is then nobody's. */
  const untilAborted = <T>(work: Promise<T>): Promise<T> => {
    work.catch(() => undefined)
    return Promise.race([work, aborted])
  }

  // The person's Continue, when Sky is waiting on a step done by hand.
  let release: (() => void) | null = null
  const waitForContinue = () =>
    Promise.race([
      new Promise<void>((resolve) => {
        release = resolve
      }),
      aborted,
    ]).finally(() => {
      release = null
    })

  const engine = options.engine ?? LIVE_ENGINE
  let window: SetupWindow | null = null

  const run = async (): Promise<void> => {
    const resume = (await readResume(resumeFile)) ?? emptyResume()
    const ctx: StepContext = {
      secrets: options.secrets,
      ...(resume.projectId ? { projectId: resume.projectId } : {}),
      ...(resume.email ? { email: resume.email } : {}),
      onProject: async (projectId) => {
        resume.projectId = projectId
        await writeResume(resume, resumeFile)
        await rememberProject(projectId, options.ledgerFile)
        set({ ...state, projectId })
      },
    }
    if (ctx.projectId || ctx.email) {
      set({
        ...state,
        ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
        ...(ctx.email ? { account: ctx.email } : {}),
      })
    }
    const done = alreadyDone(resume)

    await engine.open(profileDir, async (opened) => {
      window = opened
      const { page } = opened
      opened.onClose(() => abort(new RunAborted(WINDOW_CLOSED_MESSAGE)))

      set(withPhase(state, 'signin', 'doing'))
      await untilAborted(
        engine.signIn(page, {
          onWaiting: () =>
            set(withNeedsYou(state, { step: 'signin', message: 'Sign in to Google — in the window that opened' })),
        }),
      )
      set(withPhase(state, 'signin', 'done'))

      if (options.tidyOnly) {
        set(withPhase(state, 'tidy', 'doing'))
        const gone = await untilAborted(
          engine.tidy(page, {
            secrets: options.secrets,
            keep: '',
            ...(options.ledgerFile ? { ledgerFile: options.ledgerFile } : {}),
          }),
        )
        log.info('google-setup-tidied', { projects: gone })
        set({ ...withPhase(state, 'tidy', 'done'), status: 'done', email: '' })
        return
      }

      for (const step of engine.steps) {
        if (done.has(step.key)) {
          set(withPhase(state, step.key, 'done'))
          continue
        }
        set(withPhase(state, step.key, 'doing'))
        await untilAborted(
          doStep(
            page,
            step.key,
            () => step.run(page, ctx),
            () => step.verify(page, ctx),
          ),
        )
        // What the console showed as the step ended, for the next fix — a step can end "done" on the wrong page.
        await captureStepDiagnostics(page, id, step.key, 'after')
        resume.done.push(step.key)
        if (ctx.projectId) resume.projectId = ctx.projectId
        if (ctx.email) resume.email = ctx.email
        await writeResume(resume, resumeFile)
        set(
          withPhase(
            {
              ...state,
              ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
              ...(ctx.email ? { account: ctx.email } : {}),
            },
            step.key,
            'done',
          ),
        )
      }

      // A resume past the client step takes the pair from the keychain, where that step put it.
      if (ctx.projectId && !ctx.client)
        ctx.client = (await loadProjectClient(options.secrets, ctx.projectId)) ?? undefined
      if (!ctx.projectId || !ctx.client) throw new StepFailed('The setup ended without a client to sign in with')
      set(withPhase(state, 'consent', 'doing'))
      const email = await untilAborted(
        engine.consent(page, {
          secrets: options.secrets,
          projectId: ctx.projectId,
          client: ctx.client,
          ...(ctx.email ? { email: ctx.email } : {}),
          onWaiting: () =>
            set(
              withNeedsYou(state, {
                step: 'consent',
                message: 'Google is asking what Sky may see — Sky is answering in the window',
              }),
            ),
        }),
      )
      set(withPhase({ ...state, email, account: email }, 'tidy', 'doing'))
      // Best effort: the account is connected either way; a leftover that stays is logged, not a failure.
      const projectId = ctx.projectId
      try {
        const gone = await untilAborted(
          engine.tidy(page, {
            secrets: options.secrets,
            keep: projectId,
            ...(options.ledgerFile ? { ledgerFile: options.ledgerFile } : {}),
          }),
        )
        if (gone.length > 0) log.info('google-setup-tidied', { projects: gone })
      } catch (err) {
        if (!(err instanceof StepFailed)) throw err
        await captureStepDiagnostics(page, id, 'tidy')
        log.warn('google-setup-tidy-failed', { message: err.message })
      }
      set(finished(state, email))
    })
  }

  /** A step Sky could not do becomes the person's, with Continue asking Sky to look again. */
  const doStep = async (
    page: Page,
    key: SetupPhaseKey,
    act: () => Promise<void>,
    verify: () => Promise<boolean>,
  ): Promise<void> => {
    try {
      await act()
      return
    } catch (err) {
      if (!(err instanceof StepFailed)) throw err
      const where = await captureStepDiagnostics(page, id, key)
      log.warn('google-setup-step-failed', {
        step: key,
        message: err.message,
        ...(where ? { diagnostics: where } : {}),
      })
      const instruction = GOOGLE_CLOUD_SETUP.find((step) => step.key === key)?.instruction ?? ''
      let message = `${err.message}. Do this step in the window, then press Continue.`
      for (;;) {
        set(withNeedsYou(state, { step: key, message, instruction }))
        await waitForContinue()
        set(withoutNeedsYou(state))
        if (await verify()) return
        message = 'Still not done as far as Sky can see. Do the step in the window, then press Continue.'
      }
    }
  }

  const finishedPromise = run()
    .then(async () => {
      if (state.status === 'done' && !options.tidyOnly) await clearSetupLeftovers({ file: resumeFile, profileDir })
      return state
    })
    .catch(async (err: unknown) => {
      const message =
        err instanceof NoBrowserError
          ? err.message
          : err instanceof RunAborted || err instanceof StepFailed
            ? err.message
            : `The setup stopped: ${err instanceof Error ? err.message : String(err)}`
      log.warn('google-setup-failed', { message })
      if (state.status === 'running') set(failed(state, message))
      return state
    })

  return {
    id,
    state: () => state,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    continue: () => release?.(),
    cancel() {
      abort(new RunAborted('Cancelled'))
      void window?.close()
    },
    finished: finishedPromise,
  }
}
