import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import { z } from 'zod'
import { secureOrigin, type LoginValues } from '#lib/credentials/login.ts'
import { LinkedInBrowserImport } from '#lib/linkedin/browser.ts'
import { captureLinkedInSignIn } from '#lib/linkedin/login.ts'
import { browserBinary } from '../mcp/browserDriver.ts'
import type { CallOptions, McpToolDefinition, McpToolResult } from '../mcp/client.ts'
import { SignInBroker, type SignInResult } from './broker.ts'
import { captureSignInForm } from './form.ts'
import { NativeAuthentication, type NativeAuthenticationApproval } from './nativeAuthentication.ts'
import { guardBrowserRequests } from './network.ts'
import { LoginRedactor } from './redaction.ts'
import { captureVerificationForm, verificationVisible } from './verification.ts'

const target = z.string().regex(/^(?:f\d+)?e\d+$/)
const element = z.string().max(500).optional()
const definitions = {
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
      'Request private sign-in using a saved login or SSO. The person approves in native UI; identity-provider pages and credentials stay private. Returns only a status. No arguments.',
    schema: z.object({}).strict(),
  },
} as const

const result = (text: string, isError = false): McpToolResult => ({ content: [{ type: 'text', text }], isError })
const linkedInDefinition = {
  description: 'Continue importing the selected LinkedIn profile. Returns progress or profile evidence only.',
  schema: z.object({}).strict(),
}

export interface PrivateBrowserOptions {
  filesDir: string
  broker: SignInBroker
  headless?: boolean
  executablePath?: string
  nativeApproval?: NativeAuthenticationApproval
  offerNativeChoice?: boolean
  hasSavedLogins?: boolean
  /** Limits this session to one trusted import, with no general browser tools or downloads. */
  linkedInProfile?: string
  /** Test seam for synthetic sites. The worker's start schema cannot supply it. */
  prepare?: (page: Page) => Promise<void>
}

/** One disposable task browser; authentication popups stay private. No TCP listener or reusable profile. */
export class PrivateBrowserSession {
  readonly serverInfo = { name: 'Sky private browser', version: '1' }
  private readonly redactor = new LoginRedactor()
  private readonly authParameters = new LoginRedactor()
  private readonly nativeSecrets = new LoginRedactor()
  private readonly nativeAuth: NativeAuthentication | undefined
  private readonly popups = new Set<Page>()
  private popupUrl: string | undefined
  private allowedOrigin: string | undefined
  private requestedOrigin: string | undefined
  private readonly downloads = new Set<Promise<void>>()
  private downloadMessages: string[] = []
  private busy = false
  private closed = false
  private readonly attemptedOrigins = new Set<string>()
  private readonly linkedIn: LinkedInBrowserImport | undefined

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly temporary: string,
    private readonly options: PrivateBrowserOptions,
  ) {
    this.nativeAuth = options.nativeApproval ? new NativeAuthentication(options.nativeApproval) : undefined
    if (options.linkedInProfile) {
      this.allowedOrigin = 'https://www.linkedin.com'
      this.linkedIn = new LinkedInBrowserImport(
        options.linkedInProfile,
        page,
        (signal) => this.signIn(signal),
        (text) => this.redact(text),
      )
    }
  }

  static async launch(options: PrivateBrowserOptions): Promise<PrivateBrowserSession> {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'sky-private-browser-'))
    let browser: Browser | undefined
    try {
      await mkdir(options.filesDir, { recursive: true, mode: 0o700 })
      const executablePath = options.executablePath ?? (await browserBinary())
      if (!executablePath) throw new Error('Browser unavailable')
      browser = await chromium.launch({
        executablePath,
        headless: options.headless ?? false,
        chromiumSandbox: true,
        downloadsPath: temporary,
        ignoreDefaultArgs: ['--enable-automation'],
        args: ['--disable-blink-features=AutomationControlled'],
      })
      const context = await browser.newContext({
        viewport: null,
        serviceWorkers: 'block',
        acceptDownloads: !options.linkedInProfile,
      })
      context.setDefaultTimeout(5000)
      context.setDefaultNavigationTimeout(30000)
      const page = await context.newPage()
      await options.prepare?.(page)
      const session = new PrivateBrowserSession(browser, context, page, temporary, options)
      const binding = `skyPrivateInput${crypto.randomUUID().replaceAll('-', '')}`
      await context.exposeBinding(binding, (_source, values: unknown, credentialValues: unknown, secrets: unknown) => {
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
      await context.addInitScript(
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
      const attach = await guardBrowserRequests(page, {
        origin: () => session.allowedOrigin,
        containsLogin: (text) => session.redactor.contains(text),
        containsCredential: (text) => session.nativeSecrets.contains(text),
        nativeActive: () => session.nativeAuth?.active ?? false,
        authorizeNavigation: (origin) => session.nativeAuth?.permit(origin) ?? Promise.resolve(false),
        rememberResponseParameters: (url, body) => session.rememberAuthParameters(url, body),
        unguardedPopup: (url) => {
          session.popupUrl ??= url
        },
      })
      context.on('page', (opened) => {
        if (opened === page) return
        void (async () => {
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
        if (options.linkedInProfile || session.nativeAuth?.pending) {
          void download.cancel().catch(() => {})
          return
        }
        const work = (async () => {
          const source = await download.path()
          if (!source || session.closed) return
          const bytes = await readFile(source)
          // Credential echoes must not reach read_file, notebook attachments, or task artifacts.
          if (
            session.redactor.contains(bytes.toString('utf8')) ||
            session.authParameters.contains(bytes.toString('utf8'))
          ) {
            session.downloadMessages.push('A download containing login data was withheld.')
            return
          }
          const name = path.basename(download.suggestedFilename()).replace(/[\p{Cc}\p{Cf}]/gu, '_') || 'download'
          if (session.redactor.contains(name) || session.authParameters.contains(name)) {
            session.downloadMessages.push('A download containing login data was withheld.')
            return
          }
          for (let index = 1; index <= 1000; index++) {
            const destination = path.join(options.filesDir, index === 1 ? name : `${index}-${name}`)
            try {
              await copyFile(source, destination, 1)
              session.downloadMessages.push(`Downloaded file ${path.basename(destination)} to "${destination}"`)
              return
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            }
          }
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
    } catch {
      await browser?.close().catch(() => {})
      await rm(temporary, { recursive: true, force: true })
      throw new Error('The private browser could not start.')
    }
  }

  async listTools(): Promise<McpToolDefinition[]> {
    return Object.entries(this.linkedIn ? { linkedin_step: linkedInDefinition } : definitions).map(
      ([name, definition]) => ({
        name,
        description: definition.description,
        inputSchema: z.toJSONSchema(definition.schema),
      }),
    )
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.nativeAuth?.stop()
    this.options.broker.revoke()
    await this.context.close().catch(() => {})
    await this.browser.close().catch(() => {})
    await Promise.allSettled(this.downloads)
    await rm(this.temporary, { recursive: true, force: true })
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
    if (!this.nativeAuth) return { status: 'needs_user' }
    const origin = this.allowedOrigin ?? this.requestedOrigin ?? secureOrigin(this.page.url())
    if (!origin) return { status: 'needs_user' }
    if (this.attemptedOrigins.has(`native:${origin}`)) return { status: 'needs_user' }
    this.attemptedOrigins.add(`native:${origin}`)
    if (this.allowedOrigin && origin !== this.allowedOrigin) return { status: 'needs_user' }
    this.options.broker.revoke()
    const completed = await this.nativeAuth
      .run(
        this.page,
        async () => {
          this.allowedOrigin = origin
        },
        origin,
      )
      .catch(() => false)
    this.rememberAuthParameters(this.page.url(), '')
    for (const popup of this.popups) await popup.close().catch(() => {})
    this.popupUrl = undefined
    if (!completed) {
      // Revoked/expired handoffs may have authenticated; never let a model inherit that session.
      await this.close()
      return { status: 'declined' }
    }
    return { status: 'submitted' }
  }

  private async verify(signal?: AbortSignal): Promise<SignInResult> {
    const form = await captureVerificationForm(this.page, (code) => {
      this.redactor.rememberValue(code)
      this.nativeSecrets.rememberValue(code)
    })
    if (form) return this.options.broker.verify(form, signal)
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
      this.redactor.remember(login)
      this.nativeSecrets.rememberValue(login.password)
    }
    const form = (await captureSignInForm(this.page, protect)) ?? (await captureLinkedInSignIn(this.page, protect))
    if (form && this.options.hasSavedLogins === false) {
      await form.dispose()
      return this.nativeSignIn()
    }
    if (form && this.attemptedOrigins.has(form.origin)) {
      await form.dispose()
      return { status: 'needs_user' }
    }
    if (form) this.attemptedOrigins.add(form.origin)
    if (form && this.options.offerNativeChoice && this.options.nativeApproval) {
      const method = await this.options.nativeApproval.method(form.origin)
      if (method !== 'password') {
        await form.dispose()
        return method === 'browser' ? this.nativeSignIn() : { status: 'declined' }
      }
    }
    return form ? this.options.broker.signIn(form, signal) : this.nativeSignIn()
  }

  async callTool(name: string, args: Record<string, unknown>, options: CallOptions = {}): Promise<McpToolResult> {
    const definition = this.linkedIn
      ? name === 'linkedin_step'
        ? linkedInDefinition
        : undefined
      : Object.hasOwn(definitions, name)
        ? definitions[name as keyof typeof definitions]
        : undefined
    if (!definition || !definition.schema.safeParse(args).success)
      return result('This operation is not available in the private browser.', true)
    if (this.closed || this.busy || options.signal?.aborted) return result('The browser task is stopped or busy.', true)
    this.busy = true
    const abort = () => {
      void this.close()
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      // Continuation is owned here, not a model tool: the code never enters a tool request or response.
      if (this.linkedIn || ['browser_snapshot', 'browser_wait_for', 'sign_in'].includes(name)) {
        if (await verificationVisible(this.page)) {
          const verification = await this.verify(options.signal)
          if (name === 'sign_in') return result(JSON.stringify(verification))
          if (verification.status === 'submitted') {
            if (this.linkedIn) return result('{"status":"waiting"}')
            if (await this.privateEntry())
              return result(
                this.redactor.text(
                  `- Page URL: ${this.visibleUrl()}\n- Page Title: Finishing sign-in\n\n\`\`\`yaml\n- paragraph: A saved verification code was submitted. Take a fresh snapshot to check whether sign-in completed.\n\`\`\``,
                ),
              )
          }
        } else if (!(await this.privateEntry())) this.options.broker.revoke()
      } else this.options.broker.revoke()
      if (this.linkedIn) {
        const step = await this.linkedIn.step(options.signal)
        if (step.status === 'needs_user' && this.nativeAuth && !this.attemptedOrigins.has('native')) {
          this.attemptedOrigins.add('native')
          const signed = await this.nativeSignIn()
          return result(JSON.stringify({ status: signed.status === 'submitted' ? 'waiting' : 'needs_user' }))
        }
        return result(JSON.stringify(step))
      }
      if (name === 'sign_in') {
        return result(JSON.stringify(await this.signIn(options.signal)))
      }
      if (name !== 'browser_navigate' && name !== 'browser_navigate_back' && (await this.privateEntry())) {
        return result(
          this.redactor.text(
            `- Page URL: ${this.visibleUrl()}\n- Page Title: Sign-in needs you\n\n\`\`\`yaml\n- paragraph: ${this.redactor.active ? 'The sign-in step needs the person. Use wait_for_person to finish in the browser, including any code from SMS, email, or an authenticator app. Never ask them to paste a code into chat.' : 'A sign-in or verification step is required. Use sign_in for a password login, or wait_for_person to complete the step in the browser.'} Credential entry is hidden.\n\`\`\``,
          ),
        )
      }
      const locator = typeof args.target === 'string' ? this.page.locator(`aria-ref=${args.target}`) : null
      switch (name) {
        case 'browser_snapshot': {
          const snapshot = await this.page.ariaSnapshot({ mode: 'ai', boxes: args.boxes === true })
          return await this.withDownloads(
            `- Page URL: ${this.visibleUrl()}\n- Page Title: ${await this.page.title()}\n\n\`\`\`yaml\n${snapshot}\n\`\`\``,
          )
        }
        case 'browser_navigate': {
          const url = new URL(String(args.url))
          if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            (this.allowedOrigin && url.origin !== this.allowedOrigin)
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
    } catch {
      return result('The browser action could not complete. Take a fresh snapshot or ask the person.', true)
    } finally {
      this.busy = false
      options.signal?.removeEventListener('abort', abort)
    }
  }
}
