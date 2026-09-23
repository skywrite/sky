import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import type { SetupStepKey } from '../setup.ts'
import { saveProjectClient } from '../tokens.ts'
import type { ConsoleStep, StepContext } from './consoleSteps.ts'
import { StepFailed } from './page.ts'
import { readLedger, readResume, writeLedger } from './resume.ts'
import { type SetupEngine, type SetupWindow, WINDOW_CLOSED_MESSAGE, startCloudSetup } from './run.ts'
import type { CloudSetupState } from './state.ts'
import { leftoverProjects } from './tidy.ts'

// The runner is driven here with scripted parts: no browser, no console.
// What is under test is the checklist the page reads, the pause when Sky
// cannot do a step, the pick-up after a stop, and the window closing.

const PAGE = {} as Page

function tempFiles(): Promise<{ dir: string; resumeFile: string; profileDir: string; ledgerFile: string }> {
  return mkdtemp(path.join(os.tmpdir(), 'sky-google-setup-')).then((dir) => ({
    dir,
    resumeFile: path.join(dir, 'setup.json'),
    profileDir: path.join(dir, 'profile'),
    ledgerFile: path.join(dir, 'projects.json'),
  }))
}

/** A window that opens at once; `closeIt` is what the person closing it does. */
function window(): { open: SetupEngine['open']; closeIt: () => void } {
  let handler: () => void = () => undefined
  const opened: SetupWindow = {
    page: PAGE,
    onClose: (h) => {
      handler = h
    },
    close: async () => handler(),
  }
  return {
    open: async (_profileDir, fn) => {
      await fn(opened)
    },
    closeIt: () => handler(),
  }
}

function step(key: SetupStepKey, run: (ctx: StepContext) => Promise<void>, verify = async () => true): ConsoleStep {
  return { key, run: (_page, ctx) => run(ctx), verify: async () => verify() }
}

const project = step('project', async (ctx) => {
  ctx.projectId = 'atlas-123456'
  await ctx.onProject?.('atlas-123456')
})
const apis = step('apis', async () => undefined)
const branding = step('branding', async (ctx) => {
  ctx.email = 'jane@example.com'
})
const publish = step('publish', async () => undefined)
const client = step('client', async (ctx) => {
  ctx.client = { clientId: 'id-1', clientSecret: 'sec-1' }
})

function engine(
  parts: Partial<SetupEngine> & { open: SetupEngine['open'] },
  granted = 'jane@example.com',
): SetupEngine {
  return {
    signIn: async (_page, options) => options.onWaiting(),
    steps: [project, apis, branding, publish, client],
    consent: async (_page, options) => {
      options.onWaiting()
      return granted
    },
    tidy: async () => [],
    ...parts,
  }
}

function marks(state: CloudSetupState): string {
  return state.steps.map((s) => `${s.key}:${s.state}`).join(' ')
}

test('a run that goes through', async () => {
  const files = await tempFiles()
  const secrets = new TestSecretsProvider()
  const seen: CloudSetupState[] = []
  const run = startCloudSetup({
    secrets,
    agreedToTerms: true,
    ...files,
    engine: engine({ open: window().open }),
  })
  run.onChange((state) => seen.push(state))
  const final = await run.finished

  assert({
    given: 'every part doing its job',
    should: 'end done, naming the account, with every step ticked',
    expected: ['done', 'jane@example.com', 'atlas-123456', true],
    actual: [final.status, final.email, final.projectId, final.steps.every((s) => s.state === 'done')],
  })
  assert({
    given: 'the two moments the person is needed',
    should: 'be told in plain words, and be cleared once the run moves on',
    expected: [
      'Sign in to Google — in the window that opened',
      'Google is asking what Sky may see — Sky is answering in the window',
      false,
    ],
    actual: [
      seen.find((s) => s.needsYou?.step === 'signin')?.needsYou?.message,
      seen.find((s) => s.needsYou?.step === 'consent')?.needsYou?.message,
      Boolean(final.needsYou),
    ],
  })
  assert({
    given: 'a finished run',
    should: 'leave no resume note behind, and keep its project in the ledger',
    expected: [null, ['atlas-123456']],
    actual: [await readResume(files.resumeFile), (await readLedger(files.ledgerFile)).projects.map((p) => p.id)],
  })
  await rm(files.dir, { recursive: true, force: true })
})

test('the tidy-up names the leftovers: Sky’s own projects that no account uses, the new one aside', async () => {
  const files = await tempFiles()
  const secrets = new TestSecretsProvider()
  await saveProjectClient(secrets, 'atlas-inuse1', { clientId: 'id', clientSecret: 'sec' })
  await writeLedger(
    {
      v: 1,
      projects: [
        { id: 'atlas-inuse1', at: '2026-09-01T00:00:00.000Z' },
        { id: 'atlas-left01', at: '2026-09-02T00:00:00.000Z' },
        { id: 'atlas-new001', at: '2026-09-03T00:00:00.000Z' },
      ],
    },
    files.ledgerFile,
  )
  assert({
    given: 'a ledger with a project in use, a leftover, and the one just made',
    should: 'name only the leftover',
    expected: ['atlas-left01'],
    actual: await leftoverProjects(secrets, 'atlas-new001', files.ledgerFile),
  })
  await rm(files.dir, { recursive: true, force: true })
})

test('a step Sky cannot do becomes the person’s, with Continue asking Sky to look again', async () => {
  const files = await tempFiles()
  const secrets = new TestSecretsProvider()
  let looked = 0
  const stubbornPublish: ConsoleStep = {
    key: 'publish',
    run: async () => {
      throw new StepFailed('Could not find the Publish app button')
    },
    verify: async () => {
      looked += 1
      return looked >= 2
    },
  }
  const run = startCloudSetup({
    secrets,
    agreedToTerms: true,
    ...files,
    engine: engine({ open: window().open, steps: [project, apis, branding, stubbornPublish, client] }),
  })
  const waits: string[] = []
  run.onChange((state) => {
    if (state.needsYou?.instruction) {
      waits.push(state.needsYou.message)
      // The person presses Continue; Sky looks again — twice here.
      setTimeout(() => run.continue(), 0)
    }
  })
  const final = await run.finished

  assert({
    given: 'a step whose anchor is missing, and a person who presses Continue twice',
    should: 'show the written step, say when it still is not done, and go on once it is',
    expected: [
      'Could not find the Publish app button. Do this step in the window, then press Continue.',
      'Still not done as far as Sky can see. Do the step in the window, then press Continue.',
      'done',
      2,
    ],
    actual: [waits[0], waits[1], final.status, looked],
  })
  await rm(files.dir, { recursive: true, force: true })
})

test('a closed window stops the run, and the next run picks up after the steps already done', async () => {
  const files = await tempFiles()
  const secrets = new TestSecretsProvider()
  const first = window()
  const stopsHere: ConsoleStep = {
    key: 'branding',
    run: async () => {
      first.closeIt()
      await new Promise((resolve) => setTimeout(resolve, 50))
    },
    verify: async () => false,
  }
  const run = startCloudSetup({
    secrets,
    agreedToTerms: true,
    ...files,
    engine: engine({ open: first.open, steps: [project, apis, stopsHere, publish, client] }),
  })
  const stopped = await run.finished
  const note = await readResume(files.resumeFile)

  assert({
    given: 'the person closing the window during the third step',
    should: 'fail with the pick-up message and keep the note of the two steps done',
    expected: ['failed', WINDOW_CLOSED_MESSAGE, 'atlas-123456', ['project', 'apis']],
    actual: [stopped.status, stopped.message, note?.projectId, note?.done],
  })

  const ran: string[] = []
  const counting = (s: ConsoleStep): ConsoleStep => ({
    ...s,
    run: async (page, ctx) => {
      ran.push(s.key)
      await s.run(page, ctx)
    },
  })
  const again = startCloudSetup({
    secrets,
    agreedToTerms: true,
    ...files,
    engine: engine({
      open: window().open,
      steps: [counting(project), counting(apis), counting(branding), counting(publish), counting(client)],
    }),
  })
  const final = await again.finished
  assert({
    given: 'a second run on the same note',
    should: 'skip the steps already done, keep the project, and finish',
    expected: [['branding', 'publish', 'client'], 'atlas-123456', 'done', true],
    actual: [
      ran,
      final.projectId,
      final.status,
      await readFile(files.resumeFile, 'utf8')
        .then(() => false)
        .catch(() => true),
    ],
  })
  await rm(files.dir, { recursive: true, force: true })
})

test('cancel ends the run', async () => {
  const files = await tempFiles()
  const secrets = new TestSecretsProvider()
  const run = startCloudSetup({
    secrets,
    agreedToTerms: true,
    ...files,
    engine: engine({
      open: window().open,
      signIn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10_000))
      },
    }),
  })
  setTimeout(() => run.cancel(), 20)
  const final = await run.finished
  assert({
    given: 'Cancel while the sign-in is waiting',
    should: 'end failed as cancelled',
    expected: ['failed', 'Cancelled'],
    actual: [final.status, final.message],
  })
  await rm(files.dir, { recursive: true, force: true })
})
