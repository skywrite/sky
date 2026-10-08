import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  chromium,
  type BrowserContext,
  type ElementHandle,
  type FileChooser,
  type Frame,
  type Locator,
  type Page,
} from 'playwright'
import { z } from 'zod'
import { secureOrigin, type LoginValues } from '#lib/credentials/login.ts'
import { readProfileEvidence } from '#lib/linkedin/evidence.ts'
import { captureLinkedInSignIn } from '#lib/linkedin/login.ts'
import type { ExistingBrowserConnection } from '../existing/connection.ts'
import { captureDownloadResponse, captureInlineDownloads } from '../existing/downloads.ts'
import { NativeDownloads } from '../existing/nativeDownloads.ts'
import { browserBinary } from '../mcp/browserDriver.ts'
import type { CallOptions, McpToolDefinition, McpToolResult } from '../mcp/client.ts'
import type { BrowserUploads } from '../task/uploads.ts'
import { unpackAppleExtension } from './applePasswords.ts'
import { SignInBroker, type SignInResult } from './broker.ts'
import { captureSignInForm } from './form.ts'
import { NativeApprovalError } from './nativeApproval.ts'
import { NativeAuthentication, type NativeAuthenticationApproval } from './nativeAuthentication.ts'
import { guardBrowserRequests } from './network.ts'
import { signInProblem } from './outcome.ts'
import { acquireBrowserProfile, BrowserProfileError, BrowserSessionCookies, prepareBrowserProfile } from './profile.ts'
import { LoginRedactor } from './redaction.ts'
import { captureScriptedLogin } from './scriptedLogin.ts'
import { captureVerificationForm, verificationVisible } from './verification.ts'

const target = z.string().regex(/^(?:f\d+)?e\d+$/)
const element = z.string().max(500).optional()
const definitions = {
  browser_file_upload: {
    description:
      'Choose caller-supplied files for upload to their exact authorized origin. Use a file input target or a chooser opened by the previous click. This chooses files; check the site’s receipt afterward.',
    schema: z.object({ target: target.optional(), paths: z.array(z.string().min(1)).min(1).max(50) }).strict(),
  },
  browser_snapshot: {
    description: 'Read this task’s page. Credential entry stays private.',
    schema: z.object({ boxes: z.boolean().optional() }).strict(),
  },
  browser_navigate: {
    description: 'Open an HTTPS website in this task’s browser.',
    schema: z.object({ url: z.url().max(8000) }).strict(),
  },
  browser_navigate_back: { description: 'Go back within this task.', schema: z.object({}).strict() },
  browser_click: {
    description: 'Click a control from the latest snapshot.',
    schema: z.object({ target, element }).strict(),
  },
  browser_type: {
    description: 'Fill an ordinary text field. Use sign_in for logins.',
    schema: z
      .object({
        target,
        element,
        text: z.string().max(20000),
        submit: z.boolean().optional(),
        slowly: z.boolean().optional(),
      })
      .strict(),
  },
  browser_select_option: {
    description: 'Select values in a dropdown.',
    schema: z.object({ target, element, values: z.array(z.string().max(1000)).max(20) }).strict(),
  },
  browser_press_key: {
    description: 'Press a navigation key.',
    schema: z
      .object({
        key: z.enum([
          'Enter',
          'Tab',
          'Shift+Tab',
          'Escape',
          'ArrowDown',
          'ArrowUp',
          'ArrowLeft',
          'ArrowRight',
          'PageDown',
          'PageUp',
          'Home',
          'End',
        ]),
      })
      .strict(),
  },
  browser_mouse_wheel: {
    description: 'Scroll the page.',
    schema: z.object({ deltaX: z.number().min(-2000).max(2000), deltaY: z.number().min(-2000).max(2000) }).strict(),
  },
  browser_wait_for: {
    description: 'Wait briefly, or for visible text.',
    schema: z
      .object({
        time: z.number().min(0).max(10).optional(),
        text: z.string().max(1000).optional(),
        textGone: z.string().max(1000).optional(),
      })
      .strict(),
  },
  sign_in: {
    description:
      'Request private sign-in using a saved login, Apple Passwords, a passkey, or SSO. The person approves in native UI; identity-provider pages and credentials stay private. Returns only a status. No arguments.',
    schema: z.object({}).strict(),
  },
} as const

const result = (text: string, isError = false): McpToolResult => ({ content: [{ type: 'text', text }], isError })
// Host-only capture: the import supplies its selected URL through a no-argument model tool.
const profileDefinition = {
  schema: z.object({ url: z.url().max(8000) }).strict(),
}

export interface PrivateBrowserOptions {
  filesDir: string
  /** Stable host-owned directory. Tests supply a profile under their own temporary root. */
  profileDir: string
  signal?: AbortSignal
  /** A trusted worker connection to the user’s running browser. Never supplied by a model. */
  attached?: ExistingBrowserConnection
  uploads?: BrowserUploads
  broker: SignInBroker
  headless?: boolean
  executablePath?: string
  appleExtensionArchive?: string
  nativeApproval?: NativeAuthenticationApproval
  offerNativeChoice?: boolean
  hasSavedLogins?: boolean
  /** Test seam for synthetic sites. The worker's start schema cannot supply it. */
  prepare?: (page: Page) => Promise<void>
  /** Trusted test seam for stalled browser commands; not part of the worker protocol. */
  actionTimeoutMs?: number
}

/** One task owns Sky's persistent profile at a time; authentication popups and cookies stay inside the worker. */
export class PrivateBrowserSession {
  readonly serverInfo = { name: 'Sky private browser', version: '1' }
  private readonly redactor = new LoginRedactor()
  private readonly authParameters = new LoginRedactor()
  private readonly nativeSecrets = new LoginRedactor()
  private readonly nativeAuth: NativeAuthentication | undefined
  private readonly popups = new Set<Page>()
  private popupUrl: string | undefined
  private allowedOrigin: string | undefined
  private credentialApi: ((origin: string) => boolean) | undefined
  private credentialFrame: Frame | undefined
  private blockedNavigationOrigin: string | undefined
  private requestedOrigin: string | undefined
  private readonly downloads = new Set<Promise<void>>()
  private downloadMessages: string[] = []
  private nativeDownloads?: NativeDownloads
  private busy = false
  private chooser?: FileChooser
  private uploadOrigin?: string
  private closed = false
  private closing?: Promise<void>
  private readonly attemptedOrigins = new Set<string>()
  private lastPageUrl?: string
  private authenticating = false

  private constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly temporary: string,
    private readonly options: PrivateBrowserOptions,
    private readonly cookies: BrowserSessionCookies | undefined,
    private readonly releaseProfile: () => Promise<void>,
  ) {
    if (options.attached) this.serverInfo.name = 'Sky · existing Brave'
    this.nativeAuth = options.nativeApproval ? new NativeAuthentication(options.nativeApproval) : undefined
  }

  static async launch(options: PrivateBrowserOptions): Promise<PrivateBrowserSession> {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'sky-private-browser-'))
    let context: BrowserContext | undefined
    let releaseProfile: (() => Promise<void>) | undefined
    try {
      await mkdir(options.filesDir, { recursive: true, mode: 0o700 })
      let cookies: BrowserSessionCookies | undefined
      if (options.attached) {
        context = options.attached.context
        releaseProfile = async () => {}
      } else {
        releaseProfile = await acquireBrowserProfile(options.profileDir, options.signal)
        await prepareBrowserProfile(options.profileDir)
        options.signal?.throwIfAborted()
        const executablePath = options.executablePath ?? (await browserBinary())
        if (!executablePath) throw new Error('Browser unavailable')
        const extensionDir = path.join(options.profileDir, 'sky-extensions')
        if (options.appleExtensionArchive) await mkdir(extensionDir, { recursive: true, mode: 0o700 })
        const extension = options.appleExtensionArchive
          ? await unpackAppleExtension(options.appleExtensionArchive, extensionDir)
          : undefined
        const launchOptions = {
          executablePath,
          headless: options.headless ?? false,
          chromiumSandbox: true,
          downloadsPath: temporary,
          ignoreDefaultArgs: ['--enable-automation', ...(extension ? ['--disable-extensions'] : [])],
          args: [
            '--disable-blink-features=AutomationControlled',
            ...(extension ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] : []),
          ],
        }
        const contextOptions = {
          viewport: null,
          serviceWorkers: 'block' as const,
          acceptDownloads: true,
        }
        context = await chromium.launchPersistentContext(options.profileDir, { ...launchOptions, ...contextOptions })
        cookies = new BrowserSessionCookies(options.profileDir)
        await cookies.restore(context)
      }
      context.setDefaultTimeout(5000)
      context.setDefaultNavigationTimeout(30000)
      const page = options.attached?.page ?? context.pages()[0] ?? (await context.newPage())
      if (!options.attached) {
        await page.goto('about:blank')
        for (const extra of context.pages()) if (extra !== page) await extra.close()
      }
      await options.prepare?.(page)
      const session = new PrivateBrowserSession(context, page, temporary, options, cookies, releaseProfile)
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame() || frame === session.credentialFrame) session.credentialApi = undefined
        if (frame === page.mainFrame() && secureOrigin(frame.url())) {
          session.blockedNavigationOrigin = undefined
          session.lastPageUrl = session.visibleUrl()
        }
      })
      page.on('filechooser', (chooser) => {
        session.chooser = chooser
      })
      const binding = `skyPrivateInput${crypto.randomUUID().replaceAll('-', '')}`
      const scope = options.attached ? page : context
      await scope.exposeBinding(binding, (_source, values: unknown, credentialValues: unknown, secrets: unknown) => {
        const selected = session.nativeAuth?.pending ? values : credentialValues
        if (!Array.isArray(selected)) return
        for (const value of selected.slice(0, 100))
          if (typeof value === 'string' && value.length >= 3 && value.length <= 20000)
            session.redactor.rememberText(value)
        if (Array.isArray(secrets))
          for (const value of secrets.slice(0, 100))
            if (typeof value === 'string' && value.length >= 3 && value.length <= 20000)
              session.nativeSecrets.rememberText(value)
      })
      await scope.addInitScript(
        ({ binding }) => {
          const remember = () => {
            const fields = [...document.querySelectorAll('input')].filter((field) =>
              ['password', 'email', 'text', 'tel', 'number'].includes(field.type),
            )
            const values = fields.map((field) => field.value).filter((value) => value.length >= 3)
            const credentialValues = fields
              .filter((field) =>
                /password|username|one.?time|verification|security.?code|passcode|\botp\b|\bpin\b/i.test(
                  [field.type, field.name, field.id, field.autocomplete, field.getAttribute('aria-label')].join(' '),
                ),
              )
              .map((field) => field.value)
            const secrets = fields
              .filter((field) =>
                /password|one.?time|verification|security.?code|passcode|\botp\b|\bpin\b|\bcode\b/i.test(
                  [field.type, field.name, field.id, field.autocomplete, field.getAttribute('aria-label')].join(' '),
                ),
              )
              .map((field) => field.value)
            const send = (
              window as unknown as Record<
                string,
                (values: string[], credentialValues: string[], secrets: string[]) => Promise<void>
              >
            )[binding]
            if (values.length) void send(values, credentialValues, secrets).catch(() => {})
          }
          // Capture before page submit/click handlers run, including OS/extension autofill.
          for (const event of ['input', 'change', 'submit', 'click', 'keydown'])
            document.addEventListener(event, remember, true)
        },
        { binding },
      )
      if (options.attached) {
        session.nativeDownloads = await NativeDownloads.create({
          directories: [...(options.attached.downloadDirectories ?? []), options.filesDir],
          save: (name, bytes) => session.saveDownload(name, bytes),
          notice: (message) => session.downloadMessages.push(message),
          track: (work) => session.trackDownload(work),
        })
        session.nativeDownloads.attach(await options.attached.protocol(page))
      }
      const attach = await guardBrowserRequests(page, {
        ...(options.attached
          ? {
              protocol: options.attached.protocol,
              captureResponse: (protocol, event) =>
                session.trackDownload(
                  captureDownloadResponse(protocol, event, (name, bytes) => session.saveDownload(name, bytes)).catch(
                    () => {
                      session.downloadMessages.push('A download could not be saved.')
                      return true
                    },
                  ),
                ),
            }
          : {}),
        uploadOrigin: () => session.uploadOrigin,
        origin: () => session.allowedOrigin,
        allowSafeNavigation: true,
        blockedNavigation: (origin) => {
          session.blockedNavigationOrigin = origin
        },
        containsLogin: (text) => session.redactor.contains(text),
        containsCredential: (text) => session.nativeSecrets.contains(text),
        allowCredentialApi: (origin) => session.credentialApi?.(origin) ?? false,
        nativeActive: () => session.nativeAuth?.active ?? false,
        authorizeNavigation: (origin) => session.nativeAuth?.permit(origin) ?? Promise.resolve(false),
        rememberResponseParameters: (url, body) => session.rememberAuthParameters(url, body),
        unguardedPopup: (url) => {
          session.popupUrl ??= url
        },
      })
      if (options.attached)
        await captureInlineDownloads(
          page,
          (name, bytes) => session.saveDownload(name, bytes),
          () => session.downloadMessages.push('A download could not be saved.'),
          (work) => session.trackDownload(work),
        )
      context.on('page', (opened) => {
        if (opened === page) return
        void (async () => {
          if (options.attached) {
            if ((await opened.opener()) !== page) return
            session.popups.add(opened)
            opened.on('close', () => session.popups.delete(opened))
            session.nativeDownloads?.attach(await options.attached.protocol(opened))
            await attach(opened)
            await captureInlineDownloads(
              opened,
              (name, bytes) => session.saveDownload(name, bytes),
              () => session.downloadMessages.push('A download could not be saved.'),
              (work) => session.trackDownload(work),
            )
            return
          }
          if (!session.nativeAuth?.active || session.popups.size >= 1) {
            await opened.close()
            return
          }
          session.popups.add(opened)
          opened.on('close', () => session.popups.delete(opened))
          opened.on('download', (download) => {
            void download.cancel()
          })
          opened.on('dialog', (dialog) => {
            void dialog.dismiss().catch(() => {})
          })
          await attach(opened)
          const url = session.popupUrl
          session.popupUrl = undefined
          if (url && session.nativeAuth.active) await opened.goto(url, { waitUntil: 'domcontentloaded' })
        })().catch(() => {
          void opened.close().catch(() => {})
        })
      })
      page.on('dialog', (dialog) => {
        void dialog.dismiss().catch(() => {})
      })
      page.on('download', (download) => {
        if (session.nativeAuth?.pending) {
          void download.cancel().catch(() => {})
          return
        }
        const work = (async () => {
          const source = await download.path()
          if (!source || session.closed) return
          const bytes = await readFile(source)
          await session.saveDownload(download.suggestedFilename(), bytes)
        })()
          .catch(() => {
            session.downloadMessages.push('A download could not be saved.')
          })
          .finally(async () => {
            await download.delete().catch(() => {})
            session.downloads.delete(work)
          })
        session.downloads.add(work)
      })
      return session
    } catch (error) {
      if (options.attached) await options.attached.close()
      else await context?.close().catch(() => {})
      await rm(temporary, { recursive: true, force: true })
      await releaseProfile?.()
      if (error instanceof BrowserProfileError) throw error
      throw new Error('The private browser could not start.')
    }
  }

  async listTools(): Promise<McpToolDefinition[]> {
    return Object.entries(definitions)
      .filter(([name]) => name !== 'browser_file_upload' || !!this.options.uploads?.files.length)
      .map(([name, definition]) => ({
        name,
        description: definition.description,
        inputSchema: z.toJSONSchema(definition.schema),
      }))
  }

  close(): Promise<void> {
    return (this.closing ??= this.finish())
  }

  private async finish(): Promise<void> {
    this.closed = true
    this.nativeDownloads?.close()
    this.nativeAuth?.stop()
    this.options.broker.revoke()
    try {
      await this.cookies?.save(this.context)
    } finally {
      if (this.options.attached) {
        for (const popup of this.popups) await popup.close().catch(() => {})
        await this.options.attached.close()
      } else await this.context.close().catch(() => {})
      await Promise.allSettled(this.downloads)
      try {
        await rm(this.temporary, { recursive: true, force: true })
      } finally {
        await this.releaseProfile()
      }
    }
  }

  private trackDownload<T>(work: Promise<T>): Promise<T> {
    const pending = work
      .then(
        () => {},
        () => {},
      )
      .finally(() => this.downloads.delete(pending))
    this.downloads.add(pending)
    return work
  }

  private async saveDownload(suggestedName: string, bytes: Buffer): Promise<void> {
    if (this.closed) return
    const name = path.basename(suggestedName).replace(/[\p{Cc}\p{Cf}]/gu, '_') || 'download'
    if (
      this.redactor.contains(bytes.toString('utf8')) ||
      this.authParameters.contains(bytes.toString('utf8')) ||
      this.redactor.contains(name) ||
      this.authParameters.contains(name)
    ) {
      this.downloadMessages.push('A download containing login data was withheld.')
      return
    }
    for (let index = 1; index <= 1000; index++) {
      const destination = path.join(this.options.filesDir, index === 1 ? name : `${index}-${name}`)
      try {
        await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 })
        this.downloadMessages.push(`Downloaded file ${path.basename(destination)} to "${destination}"`)
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw new Error('No available download filename')
  }

  private async privateEntry(): Promise<boolean> {
    return (
      (await verificationVisible(this.page)) ||
      (await this.page
        .locator(
          'input[type="password"]:visible, input[autocomplete~="one-time-code"]:visible, input[autocomplete~="username"]:visible',
        )
        .count()) > 0
    )
  }

  private redact(text: string): string {
    return this.authParameters.text(this.redactor.text(text))
  }

  private rememberAuthParameters(address: string, body: string): void {
    const url = new URL(address)
    const remember = (text: string) => {
      if (text.length >= 4 && text.length < 100000) this.authParameters.rememberText(text)
    }
    const auth = /token|code|state|assertion|saml|session|ticket|credential|signature/i
    for (const [key, value] of url.searchParams) if (auth.test(key)) remember(value)
    for (const [key, value] of new URLSearchParams(url.hash.slice(1))) if (auth.test(key)) remember(value)
    for (const value of new URLSearchParams(body).values()) remember(value)
    try {
      const visit = (value: unknown, depth = 0) => {
        if (typeof value === 'string') remember(value)
        else if (value && typeof value === 'object' && depth < 5)
          for (const entry of Object.values(value)) visit(entry, depth + 1)
      }
      visit(JSON.parse(body))
    } catch {
      /* Most forms use URL encoding. */
    }
  }

  private async nativeSignIn(): Promise<SignInResult> {
    if (this.options.attached) return { status: 'needs_user' }
    if (!this.nativeAuth) return { status: 'needs_user', reason: 'unsupported_page' }
    const origin = this.allowedOrigin ?? this.requestedOrigin ?? secureOrigin(this.page.url())
    if (!origin) return { status: 'needs_user', reason: 'unsupported_page' }
    if (this.attemptedOrigins.has(`native:${origin}`)) return { status: 'needs_user', reason: 'already_attempted' }
    this.attemptedOrigins.add(`native:${origin}`)
    if (this.allowedOrigin && origin !== this.allowedOrigin) return { status: 'needs_user', reason: 'page_changed' }
    this.options.broker.revoke()
    let approvalFailed = false
    const completed = await this.nativeAuth
      .run(
        this.page,
        async () => {
          this.allowedOrigin = origin
        },
        origin,
      )
      .catch((error) => {
        approvalFailed = error instanceof NativeApprovalError
        return false
      })
    this.rememberAuthParameters(this.page.url(), '')
    for (const popup of this.popups) await popup.close().catch(() => {})
    this.popupUrl = undefined
    if (!completed) {
      // End this task's access on cancellation; saved sign-ins remain available to a later task.
      await this.close()
      return approvalFailed
        ? { status: 'unavailable', reason: 'approval_unavailable' }
        : { status: 'declined', reason: 'browser_not_approved' }
    }
    return { status: 'submitted' }
  }

  private async verify(signal?: AbortSignal): Promise<SignInResult> {
    const form = await captureVerificationForm(this.page, (code) => {
      this.redactor.rememberValue(code)
      this.nativeSecrets.rememberValue(code)
    })
    if (form) {
      this.authenticating = true
      try {
        return await this.options.broker.verify(form, signal)
      } finally {
        this.authenticating = false
      }
    }
    this.options.broker.revoke()
    return { status: 'needs_user' }
  }

  private visibleUrl(): string {
    const url = new URL(this.page.url())
    // Redirects can carry authorization codes or session tokens in query/fragment parameters.
    return url.protocol === 'https:' || url.protocol === 'http:' ? `${url.origin}${url.pathname}` : 'about:blank'
  }

  private async withDownloads(text: string): Promise<McpToolResult> {
    await Promise.allSettled(this.downloads)
    return result(this.redact([text, ...this.downloadMessages.splice(0)].join('\n')))
  }

  private signInResult(signed: SignInResult): McpToolResult {
    return result(
      JSON.stringify({
        ...signed,
        ...(signed.reason ? { origin: signed.origin ?? secureOrigin(this.page.url()) ?? undefined } : {}),
        ...(signed.reason ? { message: signInProblem(signed, this.visibleUrl()) } : {}),
      }),
    )
  }

  private async ordinaryField(locator: Locator): Promise<boolean> {
    return locator.evaluate((element) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false
      const info = [
        element.type,
        element.name,
        element.id,
        element.autocomplete,
        element.getAttribute('aria-label') ?? '',
      ].join(' ')
      return !/password|passcode|one.?time|verification|security.?code|\botp\b/i.test(info)
    })
  }

  private async signIn(signal?: AbortSignal): Promise<SignInResult> {
    if (await verificationVisible(this.page)) return this.verify(signal)
    if (this.nativeAuth && this.requestedOrigin && secureOrigin(this.page.url()) !== this.requestedOrigin)
      return this.nativeSignIn()
    const protect = (origin: string, login: LoginValues) => {
      this.allowedOrigin = origin
      this.credentialApi = undefined
      this.credentialFrame = undefined
      this.redactor.remember(login)
      this.nativeSecrets.rememberValue(login.password)
    }
    const capture = async () =>
      (await captureSignInForm(this.page, protect)) ??
      (await captureLinkedInSignIn(this.page, protect)) ??
      (await captureScriptedLogin(this.page, (origin, login, frame) => {
        protect(origin, login)
        const deadline = performance.now() + 120_000
        const permitsOrigin = login.permitsOrigin
        if (permitsOrigin) {
          this.credentialFrame = frame
          this.credentialApi = (destination) => performance.now() < deadline && permitsOrigin(destination)
        }
      }))
    let form = await capture()
    if (!form && this.options.attached && !this.allowedOrigin && !(await this.privateEntry())) {
      // A public landing page can be classified as needing sign-in before the
      // driver opens its login link. Follow only one unambiguous visible HTTPS
      // destination, without reading credentials, then capture the actual form.
      const links = await this.page
        .getByRole('link', { name: /^(?:sign|log)\s?in$/i })
        .evaluateAll((elements) =>
          elements
            .filter((element) => element instanceof HTMLAnchorElement && element.getClientRects().length > 0)
            .map((element) => (element as HTMLAnchorElement).href),
        )
      const destinations = [...new Set(links)].filter((url) => secureOrigin(url) && url !== this.page.url())
      if (destinations.length === 1) {
        await this.page.goto(destinations[0]!, { waitUntil: 'domcontentloaded' })
        await this.page
          .locator('input[type="password"]:visible')
          .first()
          .waitFor({ timeout: 5000 })
          .catch(() => {})
        form = await capture()
        if (!form) return { status: 'navigated' }
      }
    }
    if (form && this.options.hasSavedLogins === false) {
      await form.dispose()
      return this.nativeSignIn()
    }
    if (form && this.attemptedOrigins.has(form.origin)) {
      await form.dispose()
      return { status: 'needs_user', reason: 'already_attempted' }
    }
    if (form) this.attemptedOrigins.add(form.origin)
    if (form && this.options.offerNativeChoice && this.options.nativeApproval) {
      let method: Awaited<ReturnType<NativeAuthenticationApproval['method']>>
      try {
        method = await this.options.nativeApproval.method(form.origin)
      } catch (error) {
        await form.dispose()
        if (error instanceof NativeApprovalError) return { status: 'unavailable', reason: 'approval_unavailable' }
        throw error
      }
      if (method !== 'password') {
        await form.dispose()
        return method === 'browser' ? this.nativeSignIn() : { status: 'declined', reason: 'cancelled' }
      }
      // Choosing a method has not authorized a lookup yet. A reactive page may
      // replace its form while that dialog is open; capture it again before the
      // broker asks for permission. Never carry this choice to a different site.
      const origin = form.origin
      await form.dispose()
      form = await capture()
      if (!form || form.origin !== origin) {
        await form?.dispose()
        return { status: 'needs_user', reason: 'page_changed' }
      }
    }
    if (
      !form &&
      this.options.attached &&
      this.options.hasSavedLogins !== false &&
      (await this.page.locator('input[type="password"]:visible').count()) > 0
    )
      return { status: 'needs_user', reason: 'unsupported_page' }
    return form ? this.options.broker.signIn(form, signal) : this.nativeSignIn()
  }

  recoveryUrl(): string | undefined {
    return this.lastPageUrl
  }

  async callTool(name: string, args: Record<string, unknown>, options: CallOptions = {}): Promise<McpToolResult> {
    // Native authentication has its own approval deadline. Ordinary browser
    // input (notably Playwright's mouse wheel) otherwise has no timeout at all.
    if (name === 'sign_in') return this.performTool(name, args, options)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<McpToolResult>((resolve) => {
      const expire = () => {
        if (this.authenticating) {
          timer = setTimeout(expire, this.options.actionTimeoutMs ?? 30_000)
          return
        }
        // Retire this page before another action can run. The caller must inspect
        // the replacement page; a timed-out click may already have taken effect.
        void this.close().catch(() => {})
        resolve({
          ...result(
            `The browser stopped responding during ${name}. The action's outcome must be checked before retrying.`,
            true,
          ),
          structuredContent: { kind: 'browser_timeout', operation: name },
        })
      }
      timer = setTimeout(expire, this.options.actionTimeoutMs ?? 30_000)
    })
    try {
      return await Promise.race([this.performTool(name, args, options), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  private async performTool(name: string, args: Record<string, unknown>, options: CallOptions): Promise<McpToolResult> {
    const definition =
      name === 'sky_read_linkedin_profile'
        ? profileDefinition
        : name === 'sky_show_browser'
          ? definitions.sign_in
          : Object.hasOwn(definitions, name)
            ? definitions[name as keyof typeof definitions]
            : undefined
    if (!definition || !definition.schema.safeParse(args).success)
      return result('This operation is not available in the private browser.', true)
    if (this.closed || this.busy || options.signal?.aborted)
      return name === 'sign_in'
        ? this.signInResult({
            status: 'unavailable',
            reason: options.signal?.aborted ? 'cancelled' : this.closed ? 'browser_unavailable' : 'busy',
          })
        : result('The browser task is stopped or busy.', true)
    this.busy = true
    const abort = () => {
      void this.close()
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    let signInOperation: SignInResult['operation'] = 'inspect'
    try {
      if (name === 'sky_show_browser') {
        await this.page.bringToFront()
        return result('The task browser is ready for your help.')
      }
      if (
        this.options.attached &&
        [
          'sign_in',
          'browser_click',
          'browser_type',
          'browser_select_option',
          'browser_press_key',
          'browser_mouse_wheel',
          'browser_file_upload',
        ].includes(name)
      ) {
        signInOperation = 'activate'
        if (this.options.attached.activateTaskTab) await this.options.attached.activateTaskTab()
        else await this.page.bringToFront()
        signInOperation = 'inspect'
      }
      // Continuation is owned here, not a model tool: the code never enters a tool request or response.
      if (['browser_snapshot', 'browser_wait_for', 'sign_in'].includes(name)) {
        if (await verificationVisible(this.page)) {
          const verification = await this.verify(options.signal)
          if (name === 'sign_in') return result(JSON.stringify(verification))
          if (verification.status === 'submitted') {
            if (await this.privateEntry())
              return {
                ...result(
                  this.redactor.text(
                    `- Page URL: ${this.visibleUrl()}\n- Page Title: Finishing sign-in\n\n\`\`\`yaml\n- paragraph: A saved verification code was submitted. Take a fresh snapshot to check whether sign-in completed.\n\`\`\``,
                  ),
                ),
                structuredContent: { kind: 'authentication_required' },
              }
          }
        } else if (!(await this.privateEntry())) this.options.broker.revoke()
      } else this.options.broker.revoke()
      if (name === 'sign_in') {
        if (this.uploadOrigin)
          return result('Files have been selected. Finish this upload before starting another sign-in task.', true)
        let signed = await this.signIn(options.signal)
        if (this.blockedNavigationOrigin && signed.status !== 'declined' && signed.reason !== 'approval_unavailable')
          signed = { status: 'unavailable', reason: 'blocked_navigation', origin: this.blockedNavigationOrigin }
        return this.signInResult(signed)
      }
      if (name === 'browser_snapshot' && this.blockedNavigationOrigin)
        return result(
          signInProblem(
            { status: 'unavailable', reason: 'blocked_navigation', origin: this.blockedNavigationOrigin },
            this.visibleUrl(),
          ),
          true,
        )
      if (name !== 'browser_navigate' && name !== 'browser_navigate_back' && (await this.privateEntry())) {
        return {
          ...result(
            this.redactor.text(
              `- Page URL: ${this.visibleUrl()}\n- Page Title: Sign-in needs you\n\n\`\`\`yaml\n- paragraph: ${this.redactor.active ? 'The sign-in step needs the person. Use wait_for_person to finish in the browser, including any code from SMS, email, or an authenticator app. Never ask them to paste a code into chat.' : 'A sign-in or verification step is required. Use sign_in for a password login, or wait_for_person to complete the step in the browser.'} Credential entry is hidden.\n\`\`\``,
            ),
          ),
          structuredContent: { kind: 'authentication_required' },
        }
      }
      const locator = typeof args.target === 'string' ? this.page.locator(`aria-ref=${args.target}`) : null
      switch (name) {
        case 'sky_read_linkedin_profile': {
          try {
            const profile = await readProfileEvidence(this.page, String(args.url))
            return result(this.redact(JSON.stringify(profile)))
          } catch {
            return result(
              'The selected LinkedIn profile is not readable on this page. Open the requested profile, wait for its content, and try capture_profile again.',
              true,
            )
          }
        }
        case 'browser_file_upload': {
          const uploads = this.options.uploads
          if (!uploads || secureOrigin(this.page.url()) !== uploads.origin)
            return result('Uploads are limited to the caller’s exact destination.', true)
          const requested = (args.paths as string[]).map((file) => uploads.files.find((entry) => entry.path === file))
          if (requested.some((entry) => !entry))
            return result('Only the files supplied by the caller can be uploaded.', true)
          const input: ElementHandle | null | undefined = locator
            ? await locator.elementHandle()
            : this.chooser?.element()
          if (
            !input ||
            !(await input.evaluate(
              (element, origin) =>
                element instanceof HTMLInputElement &&
                element.type === 'file' &&
                element.ownerDocument.location.origin === origin,
              uploads.origin,
            ))
          ) {
            return result('Open the destination’s file chooser or select a file input on that origin.', true)
          }
          this.uploadOrigin = uploads.origin
          this.allowedOrigin = uploads.origin
          const files = await Promise.all(
            requested.map(async (entry) => ({
              name: entry!.name,
              mimeType:
                path.extname(entry!.name).toLowerCase() === '.pdf' ? 'application/pdf' : 'application/octet-stream',
              buffer: await readFile(entry!.path),
            })),
          )
          await input.setInputFiles(files)
          this.chooser = undefined
          return result(
            'Files selected for the authorized destination. Check the site’s receipt or file list before claiming upload success.',
          )
        }
        case 'browser_snapshot': {
          const snapshot = await this.page.ariaSnapshot({ mode: 'ai', boxes: args.boxes === true })
          const viewport = await this.page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
          return await this.withDownloads(
            `- Page URL: ${this.visibleUrl()}\n- Page Title: ${await this.page.title()}\n- Viewport: ${viewport.width}x${viewport.height}\n\n\`\`\`yaml\n${snapshot}\n\`\`\``,
          )
        }
        case 'browser_navigate': {
          const url = new URL(String(args.url))
          if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            (this.allowedOrigin && url.origin !== this.allowedOrigin && url.origin !== secureOrigin(this.page.url()))
          )
            return result('This destination is not permitted for this browser task.', true)
          this.requestedOrigin = url.origin
          await this.page.goto(url.href, { waitUntil: 'domcontentloaded' })
          break
        }
        case 'browser_navigate_back':
          await this.page.goBack({ waitUntil: 'domcontentloaded' })
          break
        case 'browser_click':
          await locator!.click()
          break
        case 'browser_type':
          if ((await this.privateEntry()) || !(await this.ordinaryField(locator!)))
            return result('Use sign_in or ask the person to complete credential fields.', true)
          await locator!.fill(String(args.text))
          if (args.submit) await locator!.press('Enter')
          break
        case 'browser_select_option':
          await locator!.selectOption(args.values as string[])
          break
        case 'browser_press_key':
          await this.page.keyboard.press(String(args.key))
          break
        case 'browser_mouse_wheel':
          await this.page.mouse.wheel(Number(args.deltaX), Number(args.deltaY))
          break
        case 'browser_wait_for':
          if (typeof args.text === 'string')
            await this.page.getByText(args.text, { exact: false }).first().waitFor({ state: 'visible' })
          else if (typeof args.textGone === 'string')
            await this.page.getByText(args.textGone, { exact: false }).first().waitFor({ state: 'hidden' })
          else await delay(Number(args.time ?? 1) * 1000, undefined, { signal: options.signal })
          break
      }
      return await this.withDownloads('Action completed. Take a fresh snapshot.')
    } catch (error) {
      if (name === 'sign_in') {
        // Capture/activation can fail before the broker starts. Keep the fixed
        // failure category; pending resource responses are not login results.
        const message = error instanceof Error ? error.message : ''
        return this.signInResult({
          status: 'unavailable',
          operation: signInOperation,
          reason: options.signal?.aborted
            ? 'cancelled'
            : /closed|disconnected|Target.*not found|No target/i.test(message)
              ? 'browser_unavailable'
              : /Timeout|timed out/i.test(message)
                ? 'browser_timeout'
                : /detached|not attached|Execution context|No element|not found/i.test(message)
                  ? 'page_changed'
                  : 'inspection_failed',
        })
      }
      if (this.downloads.size || this.downloadMessages.length)
        return this.withDownloads('Download request handled. Check the saved file before continuing.')
      // Playwright's raw errors can include page text and entered values. Keep
      // the useful failure category without serializing the native exception.
      const message = error instanceof Error ? error.message : ''
      if (/intercepts pointer events/i.test(message))
        return result(
          'Another page element is covering this control. Inspect the current page for a dialog or overlay before trying again.',
          true,
        )
      if (/detached|not attached|No element|not found/i.test(message))
        return result(
          'The selected control changed or disappeared. Take a fresh snapshot before choosing the next action.',
          true,
        )
      if (/Timeout|timed out/i.test(message))
        return result(
          'The selected control did not become ready before the browser action timed out. The page may have changed; take a fresh snapshot before repeating the action.',
          true,
        )
      return result('The browser action could not complete. Take a fresh snapshot or ask the person.', true)
    } finally {
      this.busy = false
      options.signal?.removeEventListener('abort', abort)
      if (!this.closed) await this.cookies?.save(this.context)
    }
  }
}
