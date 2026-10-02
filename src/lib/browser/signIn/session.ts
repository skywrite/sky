import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import { z } from 'zod'
import type { LoginValues } from '#lib/credentials/login.ts'
import { LinkedInBrowserImport } from '#lib/linkedin/browser.ts'
import { captureLinkedInSignIn } from '#lib/linkedin/login.ts'
import { browserBinary } from '../mcp/browserDriver.ts'
import type { CallOptions, McpToolDefinition, McpToolResult } from '../mcp/client.ts'
import { SignInBroker, type SignInResult } from './broker.ts'
import { captureSignInForm } from './form.ts'
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
      'Ask the person to authorize a matching 1Password login for the current website. Returns only a status. No account, URL, field selector, or credential arguments.',
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
  /** Limits this session to one trusted import, with no general browser tools or downloads. */
  linkedInProfile?: string
  /** Test seam for synthetic sites. The worker's start schema cannot supply it. */
  prepare?: (page: Page) => Promise<void>
}

/** One disposable browser, one page, no TCP/CDP/MCP listener, no reusable authenticated profile. */
export class PrivateBrowserSession {
  readonly serverInfo = { name: 'Sky private browser', version: '1' }
  private readonly redactor = new LoginRedactor()
  private allowedOrigin: string | undefined
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
    if (options.linkedInProfile) {
      this.allowedOrigin = 'https://www.linkedin.com'
      this.linkedIn = new LinkedInBrowserImport(
        options.linkedInProfile,
        page,
        (signal) => this.signIn(signal),
        (text) => this.redactor.text(text),
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
      // A popup may be an identity provider. It belongs to the person until a future supported flow.
      context.on('page', (opened) => {
        if (opened !== page) void opened.close().catch(() => {})
      })
      page.on('dialog', (dialog) => {
        void dialog.dismiss().catch(() => {})
      })
      await guardBrowserRequests(page, {
        origin: () => session.allowedOrigin,
        containsLogin: (text) => session.redactor.contains(text),
      })
      page.on('download', (download) => {
        if (options.linkedInProfile) {
          void download.cancel().catch(() => {})
          return
        }
        const work = (async () => {
          const source = await download.path()
          if (!source || session.closed) return
          const bytes = await readFile(source)
          // Credential echoes must not reach read_file, notebook attachments, or task artifacts.
          if (session.redactor.contains(bytes.toString('utf8'))) {
            session.downloadMessages.push('A download containing login data was withheld.')
            return
          }
          const name = path.basename(download.suggestedFilename()).replace(/[\p{Cc}\p{Cf}]/gu, '_') || 'download'
          if (session.redactor.contains(name)) {
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

  private async verify(signal?: AbortSignal): Promise<SignInResult> {
    const form = await captureVerificationForm(this.page, (code) => {
      this.redactor.rememberValue(code)
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
    return result(this.redactor.text([text, ...this.downloadMessages.splice(0)].join('\n')))
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
    const protect = (origin: string, login: LoginValues) => {
      this.allowedOrigin = origin
      this.redactor.remember(login)
    }
    const form = (await captureSignInForm(this.page, protect)) ?? (await captureLinkedInSignIn(this.page, protect))
    if (form && this.attemptedOrigins.has(form.origin)) {
      await form.dispose()
      return { status: 'needs_user' }
    }
    if (form) this.attemptedOrigins.add(form.origin)
    return form ? this.options.broker.signIn(form, signal) : { status: 'needs_user' }
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
      if (this.linkedIn) return result(JSON.stringify(await this.linkedIn.step(options.signal)))
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
