import { readFile, rm } from 'node:fs/promises'
import type { Page } from 'playwright'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import type { OAuthClient } from '../oauth.ts'
import {
  APP_DOMAIN,
  APP_HOMEPAGE_URL,
  APP_NAME,
  APP_PRIVACY_URL,
  GOOGLE_APIS,
  GOOGLE_CONSOLE_URL,
  type SetupStepKey,
  enableApisUrl,
} from '../setup.ts'
import { loadProjectClient, saveProjectClient } from '../tokens.ts'
import { StepFailed, appears, click, fill, goTo, urlBecomes } from './page.ts'

// The five console steps, each one idempotent: look first, act only on what
// is missing, then check. `verify` alone is what runs after the person did
// a step by hand and pressed Continue.

export interface StepContext {
  secrets: SecretsProvider
  projectId?: string
  /** The account, as the console showed it while naming the app */
  email?: string
  /** Filled by the client step, or on resume from the keychain */
  client?: OAuthClient
  /** Called the moment a project id is chosen, before the console makes it — so no run ever loses its project */
  onProject?: (projectId: string) => Promise<void>
}

export interface ConsoleStep {
  key: SetupStepKey
  run(page: Page, ctx: StepContext): Promise<void>
  verify(page: Page, ctx: StepContext): Promise<boolean>
}

function needProject(ctx: StepContext): string {
  if (!ctx.projectId) throw new StepFailed('No project yet — the first step has to finish first')
  return ctx.projectId
}

// ── 1. Project ─────────────────────────────────────────────────────

/**
 * The console derives the project id from the name and shows it on the
 * form ("Project ID: sky-notebook-123456.") before Create is clicked. Sky
 * reads exactly that line, writes the id to the resume note and the ledger,
 * and only then clicks — so no run ever loses the project it made. A typed
 * id of Sky's own is not used: the console accepted one twice and made
 * nothing.
 */
const PROJECT_ID_SHAPE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/

/** The derived id off the New Project form's own line, or undefined when the form does not show one. */
export function derivedProjectId(strongTexts: string[]): string | undefined {
  for (const raw of strongTexts) {
    const text = raw.trim().replace(/\.$/, '')
    if (PROJECT_ID_SHAPE.test(text)) return text
  }
  return undefined
}

const PROJECT_READY_MS = 120_000

/** The project the console is on, from its URL. */
function projectInUrl(page: Page): string | null {
  try {
    return new URL(page.url()).searchParams.get('project')
  } catch {
    return null
  }
}

/**
 * Does the console know this project — its dashboard opens on it without a
 * refusal? A project that does not exist shows "You need additional access"
 * (the console does not tell missing from forbidden), and so does one made
 * a moment ago until its permissions settle — the caller asks again.
 */
async function projectAnswers(page: Page, projectId: string): Promise<boolean> {
  await goTo(page, `${GOOGLE_CONSOLE_URL}/home/dashboard?project=${projectId}`)
  const settled = await urlBecomes(page, (url) => url.searchParams.get('project') === projectId, 30_000)
  if (!settled) return false
  const refused = page.getByText(/additional access|not found|do not have permission|does not exist|no longer exists/i)
  const dashboard = page.getByRole('heading', { name: /dashboard|project info/i })
  const outcome = await Promise.race([
    refused
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => 'refused' as const),
    dashboard
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => 'answers' as const),
  ]).catch(() => 'unknown' as const)
  return outcome === 'answers'
}

/** A project takes a moment to exist after Create; ask until it does. */
async function projectAppears(page: Page, projectId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await projectAnswers(page, projectId)) return true
    await page.waitForTimeout(5000).catch(() => undefined)
  }
  return false
}

const project: ConsoleStep = {
  key: 'project',
  async run(page, ctx) {
    // A run that stopped after the console named its project picks that project up if it was made.
    if (ctx.projectId && (await projectAnswers(page, ctx.projectId))) return

    await goTo(page, `${GOOGLE_CONSOLE_URL}/projectcreate`)
    await fill(page.getByRole('textbox', { name: /project name/i }), APP_NAME, 'the project name field')
    // The derived id shows a beat after the name is typed.
    let projectId: string | undefined
    for (let tries = 0; tries < 10 && !projectId; tries += 1) {
      await page.waitForTimeout(1000)
      projectId = derivedProjectId(
        await page
          .locator('strong')
          .allInnerTexts()
          .catch(() => []),
      )
    }
    if (!projectId) throw new StepFailed('Could not read the project id off the form')
    ctx.projectId = projectId
    await ctx.onProject?.(projectId)

    await click(page.getByRole('button', { name: /^create$/i }), 'the Create button')
    const rejected = await page
      .getByText(/must be between|already|invalid|not available/i)
      .first()
      .innerText({ timeout: 3000 })
      .catch(() => '')
    if (rejected) throw new StepFailed(`The console would not take the project: ${rejected.trim()}`)
    if (!(await projectAppears(page, projectId, PROJECT_READY_MS))) {
      const quota = await appears(page.getByText(/0 projects remaining|reached the limit|quota exceeded/i), 1000)
      throw new StepFailed(
        quota
          ? 'Google would not create another project for this account (project limit reached)'
          : `The project ${projectId} was not created — the console does not know it`,
      )
    }
  },
  async verify(page, ctx) {
    // The person made it by hand: the project the note names has to answer; the console's URL is not trusted.
    if (!ctx.projectId) return false
    return projectAnswers(page, ctx.projectId)
  },
}

// ── 2. APIs ────────────────────────────────────────────────────────

const APIS_ENABLE_MS = 180_000

const apis: ConsoleStep = {
  key: 'apis',
  async run(page, ctx) {
    const projectId = needProject(ctx)
    await goTo(page, enableApisUrl(projectId))
    // The flow confirms the project first, then enables the lot; a project already carrying them skips ahead.
    const next = page.getByRole('button', { name: /^next$/i })
    if (await appears(next, 15_000)) await click(next, 'the Next button')
    const enable = page.getByRole('button', { name: /^enable$/i })
    if (await appears(enable, 15_000)) await click(enable, 'the Enable button')
    // Leaving the flow proves nothing — it can end on an error page; the dashboard has to list them.
    await urlBecomes(page, (url) => !url.pathname.includes('/flows/enableapi'), APIS_ENABLE_MS)
    if (!(await apis.verify(page, ctx))) throw new StepFailed('The APIs did not finish switching on')
  },
  async verify(page, ctx) {
    const projectId = needProject(ctx)
    await goTo(page, `${GOOGLE_CONSOLE_URL}/apis/dashboard?project=${projectId}`)
    for (const api of GOOGLE_APIS) {
      if (!(await appears(page.getByText(api.name, { exact: true }), 10_000))) return false
    }
    return true
  },
}

// ── 3. Branding: name, audience, contact, and the links Google wants before it publishes ──

/**
 * The wizard leaves the app unpublishable: Google wants a home page and a
 * privacy policy too, on an authorized domain, before an External app goes
 * to production. The Branding page takes them.
 */
async function completeBranding(page: Page, projectId: string): Promise<void> {
  await goTo(page, `${GOOGLE_CONSOLE_URL}/auth/branding?project=${projectId}`)
  const homepage = page.getByRole('textbox', { name: /home page/i })
  if (!(await appears(homepage, 20_000))) throw new StepFailed('Could not find the Branding page')
  let changed = false
  for (const [field, value, what] of [
    [homepage, APP_HOMEPAGE_URL, 'the home page field'],
    [page.getByRole('textbox', { name: /privacy policy/i }), APP_PRIVACY_URL, 'the privacy policy field'],
  ] as const) {
    const current = await field
      .first()
      .inputValue()
      .catch(() => '')
    if (current.trim() === value) continue
    await fill(field, value, what)
    changed = true
  }
  const domains = page.getByRole('group', { name: /authorized domains/i })
  if (!(await appears(domains.getByText(APP_DOMAIN, { exact: true }), 2000))) {
    await click(domains.getByRole('button', { name: /add domain/i }), 'the Add domain button')
    await fill(domains.getByRole('textbox').last(), APP_DOMAIN, 'the new domain field')
    changed = true
  }
  if (!changed) return
  await click(page.getByRole('button', { name: /^save$/i }), 'the Save button')
  await page.waitForTimeout(4000)
}

const branding: ConsoleStep = {
  key: 'branding',
  async run(page, ctx) {
    const projectId = needProject(ctx)
    await goTo(page, `${GOOGLE_CONSOLE_URL}/auth/overview?project=${projectId}`)
    // A link on a fresh project, a button on some others.
    const getStarted = page
      .getByRole('link', { name: /get started/i })
      .or(page.getByRole('button', { name: /get started/i }))
    if (!(await appears(getStarted, 20_000))) {
      // The wizard was done before; the links may still be missing.
      await completeBranding(page, projectId)
      if (await branding.verify(page, ctx)) return
      throw new StepFailed('The app is named but Google still will not publish it')
    }
    await click(getStarted, 'the Get started button')

    // App information: the name, and the account as the support address.
    await fill(page.getByLabel(/app name/i), APP_NAME, 'the app name field')
    await click(page.getByRole('combobox', { name: /support email/i }), 'the support email list')
    const option = page.getByRole('option').first()
    if (!(await appears(option, 10_000))) throw new StepFailed('The support email list had no entries')
    ctx.email = (await option.innerText()).trim().toLowerCase()
    await click(option, 'the support email entry')
    await click(page.getByRole('button', { name: /^next$/i }), 'the Next button (app information)')

    // Audience: any Google account may grant — that is what the person's own account is.
    await click(page.getByRole('radio', { name: /external/i }), 'the External choice')
    await click(page.getByRole('button', { name: /^next$/i }), 'the Next button (audience)')

    // Contact information: the account again. The console names the field "Text field for emails".
    const contact = page.getByRole('textbox', { name: /email/i })
    await fill(contact, ctx.email, 'the contact email field')
    await contact
      .first()
      .press('Enter')
      .catch(() => undefined)
    await click(page.getByRole('button', { name: /^next$/i }), 'the Next button (contact)')

    // Finish: the User Data Policy, agreed to on Sky's start screen; then Continue, if the wizard has one, and Create.
    await click(page.getByRole('checkbox', { name: /user data policy|agree/i }), 'the User Data Policy checkbox')
    const cont = page.getByRole('button', { name: /^continue$/i })
    if (await appears(cont, 3000)) await click(cont, 'the Continue button')
    await click(page.getByRole('button', { name: /^create$/i }), 'the Create button')
    const created = await urlBecomes(page, (url) => url.pathname.includes('/auth/overview'), 60_000)
    if (!created) throw new StepFailed('The app was not named')
    await completeBranding(page, projectId)
    if (!(await branding.verify(page, ctx)))
      throw new StepFailed('The app is named but Google still will not publish it')
  },
  async verify(page, ctx) {
    // Complete means the Audience page offers Publish — a half-done wizard leaves the button disabled
    // with "complete your configuration on the Branding page" — or the app is already in production.
    // The page lags a freshly made app by a few seconds, so it is asked more than once.
    const projectId = needProject(ctx)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await goTo(page, `${GOOGLE_CONSOLE_URL}/auth/audience?project=${projectId}`)
      if (await appears(page.getByText(/in production/i), 10_000)) return true
      const publish = page.getByRole('button', { name: /publish app/i })
      if ((await appears(publish, 10_000)) && (await publish.first().isEnabled())) return true
      await page.waitForTimeout(5000)
    }
    return false
  },
}

// ── 4. Publish ─────────────────────────────────────────────────────

const publish: ConsoleStep = {
  key: 'publish',
  async run(page, ctx) {
    const projectId = needProject(ctx)
    await goTo(page, `${GOOGLE_CONSOLE_URL}/auth/audience?project=${projectId}`)
    if (await appears(page.getByText(/in production/i), 15_000)) return
    await click(page.getByRole('button', { name: /publish app/i }), 'the Publish app button')
    await click(page.getByRole('button', { name: /^confirm$/i }), 'the Confirm button')
    if (!(await appears(page.getByText(/in production/i), 30_000))) throw new StepFailed('The app did not publish')
  },
  async verify(page, ctx) {
    const projectId = needProject(ctx)
    await goTo(page, `${GOOGLE_CONSOLE_URL}/auth/audience?project=${projectId}`)
    return appears(page.getByText(/in production/i), 20_000)
  },
}

// ── 5. Client ──────────────────────────────────────────────────────

/** The pair out of the JSON Google offers for download — the same file a person would save. */
export function pairFromClientJson(text: string): OAuthClient | null {
  try {
    const parsed = JSON.parse(text) as Record<string, { client_id?: string; client_secret?: string } | undefined>
    const entry = parsed.installed ?? parsed.web
    if (entry?.client_id && entry.client_secret) return { clientId: entry.client_id, clientSecret: entry.client_secret }
  } catch {
    // not the JSON expected
  }
  return null
}

/** The pair off the page's text and fields, wherever Google put them. */
async function pairFromPage(page: Page): Promise<OAuthClient | null> {
  const values = await page
    .locator('input, textarea')
    .evaluateAll((fields) => fields.map((field) => (field as HTMLInputElement).value ?? ''))
    .catch(() => [] as string[])
  const text = [
    ...values,
    await page
      .locator('body')
      .innerText()
      .catch(() => ''),
  ].join('\n')
  const clientId = text.match(/[\w-]+\.apps\.googleusercontent\.com/)?.[0]
  const clientSecret = text.match(/GOCSPX-[\w-]+/)?.[0]
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/**
 * The pair, the moment Google shows it: first through the "Download JSON"
 * Google offers — the file a person would save, read and discarded here —
 * and failing that off the page itself. Google shows the secret only once.
 */
async function readClientPair(page: Page): Promise<OAuthClient | null> {
  const downloadButton = page
    .getByRole('button', { name: /download json/i })
    .or(page.getByRole('link', { name: /download json/i }))
  if (await appears(downloadButton, 60_000)) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        downloadButton.first().click({ timeout: 10_000 }),
      ])
      const file = await download.path()
      const text = file ? await readFile(file, 'utf8') : ''
      if (file) await rm(file, { force: true }).catch(() => undefined)
      const pair = pairFromClientJson(text)
      if (pair) return pair
    } catch {
      // no download came — the page itself is next
    }
  }
  return pairFromPage(page)
}

const client: ConsoleStep = {
  key: 'client',
  async run(page, ctx) {
    const projectId = needProject(ctx)
    const stored = await loadProjectClient(ctx.secrets, projectId)
    if (stored) {
      ctx.client = stored
      return
    }
    await goTo(page, `${GOOGLE_CONSOLE_URL}/auth/clients/create?project=${projectId}`)
    await click(page.getByRole('combobox', { name: /application type/i }), 'the application type list')
    await click(page.getByRole('option', { name: /desktop/i }), 'the Desktop app choice')
    await fill(page.getByLabel(/^name/i), APP_NAME, 'the client name field')
    await click(page.getByRole('button', { name: /^create$/i }), 'the Create button')
    const pair = await readClientPair(page)
    if (!pair) throw new StepFailed('The client was not created, or its key could not be read')
    await saveProjectClient(ctx.secrets, projectId, pair)
    ctx.client = pair
    await page
      .getByRole('button', { name: /^ok$/i })
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined)
  },
  async verify(page, ctx) {
    const projectId = needProject(ctx)
    // Made by hand: the dialog has to still be open — Google shows the secret once.
    const pair = await readClientPair(page)
    if (!pair) return false
    await saveProjectClient(ctx.secrets, projectId, pair)
    ctx.client = pair
    return true
  },
}

export const CONSOLE_STEPS: readonly ConsoleStep[] = [project, apis, branding, publish, client]
