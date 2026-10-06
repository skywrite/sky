import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:https'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type BrowserContext } from 'playwright'
import { SensitiveValue } from '#lib/credentials/SensitiveValue.ts'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'
import { SignInBroker } from '../signIn/broker.ts'
import { CredentialRun } from '../signIn/credentialRun.ts'
import { NATIVE_BROWSER } from '../signIn/nativeBrowser.ts'
import { PrivateBrowserSession } from '../signIn/session.ts'
import { prepareBrowserUploads } from '../task/uploads.ts'
import { connectExistingBrowser } from './connection.ts'

// Opt in with an unpacked official extension and a locally installed Brave.
// Every browser profile, login, document, and server in this test is synthetic.
test(
  {
    name: 'existing Brave retains its sessions while task downloads, uploads and cancellation stay scoped',
    ignore: process.env.SKY_EXTENSION_TESTS !== '1',
    timeout: 90000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-existing-browser-test-'))
    const profile = path.join(root, 'profile')
    const extension = process.env.SKY_TEST_PLAYWRIGHT_EXTENSION!
    const executablePath = process.env.SKY_TEST_BRAVE_EXECUTABLE ?? NATIVE_BROWSER.executablePath
    const args = [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
      '--ignore-certificate-errors',
    ]
    let setup: BrowserContext | undefined
    let browser: ChildProcess | undefined
    let task: PrivateBrowserSession | undefined
    const servers: Server[] = []
    try {
      const key = path.join(root, 'key.pem')
      const cert = path.join(root, 'cert.pem')
      const generated = await runCommand(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          key,
          '-out',
          cert,
          '-days',
          '1',
          '-subj',
          '/CN=localhost',
        ],
        { timeout: 10000 },
      )
      if (!generated.success) throw new Error('Could not create synthetic TLS fixture')
      const tls = { key: await readFile(key), cert: await readFile(cert) }
      const start = async (handler: Parameters<typeof createServer>[1]) => {
        const server = createServer(tls, handler)
        servers.push(server)
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Missing fixture address')
        return `https://127.0.0.1:${address.port}`
      }
      let escaped = 0
      const sink = await start((_request, response) => {
        escaped++
        response.end('Unexpected')
      })
      let seeded!: () => void
      const ready = new Promise<void>((resolve) => (seeded = resolve))
      let uploaded = ''
      const origin = await start(async (request, response) => {
        if (request.url === '/seed') {
          response.setHeader('Set-Cookie', 'atlas_session=synthetic-session; HttpOnly; Secure; Path=/')
          seeded()
        }
        if (request.url === '/document') {
          response.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="Atlas.pdf"',
          })
          response.end('%PDF-1.4 synthetic Atlas document')
          return
        }
        if (request.url === '/native-document') {
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'inline; filename="Native.pdf"',
          })
          response.end('%PDF-1.4 synthetic native download')
          return
        }
        if (request.url === '/receive') {
          for await (const chunk of request) uploaded += chunk.toString()
          response.end('received')
          return
        }
        if (request.url === '/redirect') {
          response.writeHead(307, { location: `${sink}/receive` })
          response.end()
          return
        }
        response.setHeader('Content-Type', 'text/html')
        response.end(
          `<title>Atlas connection test</title><h1>${request.headers.cookie?.includes('atlas_session=synthetic-session') ? 'Session retained' : 'Signed out'}</h1><a href="/document">Download PDF</a><a download="Inline.pdf" href="data:application/pdf,%25PDF-1.4%20synthetic%20inline">Inline PDF</a><input id="files" type="file" hidden><button onclick="document.getElementById('files').click()">Choose files</button><script>document.getElementById('files').onchange=async e=>{await fetch('/receive',{method:'POST',body:e.target.files[0]});document.querySelector('h1').textContent='Upload received'}</script>`,
        )
      })
      setup = await chromium.launchPersistentContext(profile, {
        executablePath,
        headless: true,
        args,
        ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
      })
      const settings = await setup.newPage()
      await settings.goto('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/status.html')
      await settings.waitForFunction(() => !!localStorage.getItem('auth-token'))
      const token = (await settings.evaluate(() => localStorage.getItem('auth-token')))!
      await setup.close()
      setup = undefined
      const desktop = path.join(root, 'Desktop')
      await mkdir(desktop)
      await writeFile(path.join(desktop, 'Native.pdf'), 'pre-existing file')
      // Configure only this test's temporary profile, while its browser is stopped.
      const preferencePath = path.join(profile, 'Default', 'Preferences')
      const preferences = JSON.parse(await readFile(preferencePath, 'utf8'))
      preferences.download = { ...preferences.download, default_directory: desktop, prompt_for_download: false }
      await writeFile(preferencePath, JSON.stringify(preferences))
      browser = spawn(
        executablePath,
        ['--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, ...args, `${origin}/seed`],
        { stdio: 'ignore' },
      )
      await Promise.race([
        ready,
        delay(15000).then(() => {
          throw new Error('The synthetic browser did not start')
        }),
      ])
      const attached = await connectExistingBrowser(
        token,
        { browser: 'brave' },
        { executablePath, userDataDir: profile, homeDir: root },
      )
      const source = path.join(root, 'Upload.pdf')
      await writeFile(source, '%PDF-1.4 synthetic Atlas upload')
      await mkdir(path.join(root, 'task'))
      const uploads = await prepareBrowserUploads([source], origin, path.join(root, 'task'))
      const filesDir = path.join(root, 'files')
      const broker = () =>
        new SignInBroker({
          sources: async () => [],
          connect: async () => {
            throw new Error('No password manager access in this test')
          },
          approval: { allowLookup: async () => false, choose: async () => null },
        })
      task = await PrivateBrowserSession.launch({
        filesDir,
        profileDir: path.join(root, 'unused-profile'),
        attached,
        uploads,
        broker: broker(),
      })
      await task.callTool('browser_navigate', { url: origin })
      const snapshot = await task.callTool('browser_snapshot', {})
      await attached.page.evaluate(() => {
        document.body.innerHTML =
          '<form method="get"><label>Email<input autocomplete="username"></label><input type="password"><button>Log in</button></form>'
      })
      const unsupported = await task.callTool('sign_in', {})
      assert({
        given: 'an unsupported password form in the existing Brave task tab',
        should: 'explain that Sky cannot fill the form instead of silently requesting manual verification',
        actual: [
          JSON.stringify(unsupported).includes('unsupported_page'),
          JSON.stringify(unsupported).includes('did not request a saved login'),
        ],
        expected: [true, true],
      })
      await task.callTool('browser_navigate', { url: origin })
      await attached.page.evaluate(() => {
        document.body.style.minHeight = '3000px'
      })
      const otherTab = await attached.context.newPage()
      await otherTab.goto('about:blank')
      await otherTab.bringToFront()
      const scrolled = await task.callTool('browser_mouse_wheel', { deltaX: 0, deltaY: 500 })
      await attached.page.waitForFunction(() => scrollY > 0)
      assert({
        given: 'another tab is active when Sky sends input to its task tab',
        should: 'activate only the task tab and scroll without stalling',
        actual: [scrolled.isError, await attached.page.evaluate(() => document.visibilityState)],
        expected: [false, 'visible'],
      })
      await otherTab.close()
      const download = await task.callTool('browser_navigate', { url: `${origin}/document` })
      await task.callTool('browser_navigate', { url: origin })
      await attached.page.getByRole('link', { name: 'Inline PDF' }).click()
      for (let n = 0; n < 50 && !(await readdir(filesDir)).includes('Inline.pdf'); n++) await delay(100)
      await attached.page.evaluate(() => {
        const url = URL.createObjectURL(new Blob(['%PDF-1.4 synthetic blob'], { type: 'application/pdf' }))
        const link = document.createElement('a')
        link.href = url
        link.download = 'Generated.pdf'
        link.click()
        URL.revokeObjectURL(url)
      })
      for (let n = 0; n < 50 && !(await readdir(filesDir)).includes('Generated.pdf'); n++) await delay(100)
      const native = await task.callTool('browser_navigate', { url: `${origin}/native-document` })
      for (let n = 0; n < 50 && !(await readdir(filesDir)).includes('Native (1).pdf'); n++) await delay(100)
      assert({
        given: 'a native download that bypasses response and blob-link capture, with Desktop as the save location',
        should: 'register the completed PDF with the task while preserving the browser original and prior file',
        actual: [
          JSON.stringify(native).includes('Downloaded file'),
          await readFile(path.join(filesDir, 'Native (1).pdf'), 'utf8'),
          await readFile(path.join(desktop, 'Native (1).pdf'), 'utf8'),
          await readFile(path.join(desktop, 'Native.pdf'), 'utf8'),
        ],
        expected: [
          true,
          '%PDF-1.4 synthetic native download',
          '%PDF-1.4 synthetic native download',
          'pre-existing file',
        ],
      })
      await task.callTool('browser_navigate', { url: origin })
      await attached.page.evaluate(() => {
        const button = document.createElement('button')
        button.textContent = 'Download generated file'
        button.onclick = () => {
          const link = document.createElement('a')
          link.download = 'Native-Blob.pdf'
          link.href = URL.createObjectURL(new Blob(['%PDF-1.4 synthetic dispatched blob'], { type: 'application/pdf' }))
          // A detached dispatch bypasses both the prototype click hook and document event listener.
          link.dispatchEvent(new MouseEvent('click'))
        }
        document.body.append(button)
      })
      await attached.page.getByRole('button', { name: 'Download generated file' }).click()
      for (let n = 0; n < 50 && !(await readdir(filesDir)).includes('Native-Blob.pdf'); n++) await delay(100)
      assert({
        given: 'a detached blob link dispatched without calling the click method',
        should: 'collect the native download that inline download hooks cannot observe',
        actual: [
          await readFile(path.join(filesDir, 'Native-Blob.pdf'), 'utf8'),
          await readFile(path.join(desktop, 'Native-Blob.pdf'), 'utf8'),
        ],
        expected: ['%PDF-1.4 synthetic dispatched blob', '%PDF-1.4 synthetic dispatched blob'],
      })
      await attached.page.getByRole('button', { name: 'Choose files' }).click()
      const refused = await task.callTool('browser_file_upload', { paths: [source] })
      const selected = await task.callTool('browser_file_upload', { paths: [uploads.files[0]!.path] })
      await attached.page.getByRole('heading', { name: 'Upload received' }).waitFor()
      const leaked = await attached.page.evaluate(async () => {
        try {
          await fetch('/redirect', { method: 'POST', body: 'synthetic upload bytes' })
          return true
        } catch {
          return false
        }
      })
      assert({
        given: 'a browser already running with an existing synthetic session',
        should:
          'reuse login, capture PDF and data downloads, admit only staged uploads and block redirected upload bytes',
        actual: [
          JSON.stringify(snapshot).includes('Session retained'),
          JSON.stringify(download).includes('Downloaded file'),
          await readFile(path.join(filesDir, 'Atlas.pdf'), 'utf8'),
          await readFile(path.join(filesDir, 'Inline.pdf'), 'utf8'),
          await readFile(path.join(filesDir, 'Generated.pdf'), 'utf8'),
          refused.isError,
          selected.isError,
          uploaded,
          leaked,
          escaped,
        ],
        expected: [
          true,
          true,
          '%PDF-1.4 synthetic Atlas document',
          '%PDF-1.4 synthetic inline',
          '%PDF-1.4 synthetic blob',
          true,
          false,
          '%PDF-1.4 synthetic Atlas upload',
          false,
          0,
        ],
      })
      await task.close()
      task = undefined
      const again = await connectExistingBrowser(
        token,
        { browser: 'brave' },
        { executablePath, userDataDir: profile, homeDir: root },
      )
      task = await PrivateBrowserSession.launch({
        filesDir,
        profileDir: path.join(root, 'unused-profile'),
        attached: again,
        broker: broker(),
      })
      await task.callTool('browser_navigate', { url: origin })
      const retained = await task.callTool('browser_snapshot', {})
      const abort = new AbortController()
      const waiting = task.callTool('browser_wait_for', { time: 10 }, { signal: abort.signal })
      await delay(100)
      abort.abort()
      await waiting
      await task.close()
      task = undefined
      assert({
        given: 'another task followed by cancellation',
        should: 'retain the existing session and leave the original browser running',
        actual: [JSON.stringify(retained).includes('Session retained'), browser.exitCode === null],
        expected: [true, true],
      })

      let submitted = 0
      const accountOrigin = await start((_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end('<title>Atlas account</title><h1>Fresh login retained</h1>')
      })
      const loginSite = (id: string, afterSignIn = '/', scripted = false) =>
        start(async (request, response) => {
          if (request.url === '/session' && request.method === 'POST') {
            let body = ''
            for await (const chunk of request) body += chunk.toString()
            const fields = new URLSearchParams(body)
            if (fields.get('username') === 'jane@example.com' && fields.get('password') === 'synthetic-password') {
              submitted++
              response.setHeader('Set-Cookie', `fresh_login_${id}=synthetic-session; HttpOnly; Secure; Path=/`)
            }
            response.writeHead(303, { location: afterSignIn })
            response.end()
            return
          }
          response.setHeader('Content-Type', 'text/html')
          response.end(
            request.headers.cookie?.includes(`fresh_login_${id}=synthetic-session`)
              ? '<title>Atlas account</title><h1>Fresh login retained</h1>'
              : request.url === '/'
                ? '<title>Atlas home</title><h1>Welcome</h1><a href="/login">Sign In</a><a href="/login">Sign In</a>'
                : `<title>Atlas sign-in</title><form ${scripted ? '' : 'method="post" action="/session"'}><label>Email<input name="username" autocomplete="username"></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form>${scripted ? '<script>document.querySelector("form").onsubmit=async e=>{e.preventDefault();const fields=new FormData(e.target);await fetch("/session",{method:"POST",body:new URLSearchParams(fields)});location.href="/"}</script>' : ''}`,
          )
        })
      const sites = [await loginSite('atlas', accountOrigin), await loginSite('widget', '/', true)]
      let approvals = 0
      let connections = 0
      let choices = 0
      const credentialRun = new CredentialRun({
        signal: new AbortController().signal,
        sources: async () => [{ id: 'example', account: 'example', label: 'Example', excludedVaultIds: [] }],
        approval: {
          allowLookup: async () => {
            approvals++
            return true
          },
          choose: async () => {
            choices++
            return null
          },
        },
        connect: async () => {
          connections++
          return {
            setExcludedVaultIds: () => {},
            list: async () => ({
              issues: [],
              items: sites.map((url, index) => ({
                ref: { connectionId: 'example', containerId: 'vault', itemId: `login-${index}` },
                title: 'Atlas',
                nativeCategory: 'Login',
                tags: [],
                websites: [{ url, match: 'exact' as const }],
              })),
            }),
            readLogin: async () => ({
              username: new SensitiveValue('jane@example.com'),
              password: new SensitiveValue('synthetic-password'),
            }),
          }
        },
      })
      const outcomes: boolean[] = []
      for (const [index, site] of sites.entries()) {
        const connection = await connectExistingBrowser(
          token,
          { browser: 'brave' },
          { executablePath, userDataDir: profile, homeDir: root },
        )
        task = await PrivateBrowserSession.launch({
          filesDir: path.join(root, `sign-in-${index}`),
          profileDir: path.join(root, 'unused-profile'),
          attached: connection,
          broker: credentialRun.broker(),
          hasSavedLogins: true,
        })
        await task.callTool('browser_navigate', { url: site })
        const signed = await task.callTool('sign_in', {})
        await connection.page.getByRole('heading', { name: 'Fresh login retained' }).waitFor({ timeout: 10000 })
        const snapshot = await task.callTool('browser_snapshot', {})
        outcomes.push(
          JSON.stringify(signed).includes('submitted') &&
            JSON.stringify(snapshot).includes('Fresh login retained') &&
            !JSON.stringify([signed, snapshot]).includes('synthetic-password'),
        )
        await task.close()
        task = undefined
      }
      const reconnect = await connectExistingBrowser(
        token,
        { browser: 'brave' },
        { executablePath, userDataDir: profile, homeDir: root },
      )
      task = await PrivateBrowserSession.launch({
        filesDir,
        profileDir: path.join(root, 'unused-profile'),
        attached: reconnect,
        broker: credentialRun.broker(),
        hasSavedLogins: true,
      })
      await task.callTool('browser_navigate', { url: sites[1] })
      const signedIn = await task.callTool('browser_snapshot', {})
      assert({
        given: 'fresh saved logins on two HTTPS origins through the official Brave extension',
        should:
          'submit both after one grant, retain the SDK connection, hide credentials and keep the resulting sign-in',
        actual: [
          outcomes,
          approvals,
          connections,
          choices,
          submitted,
          JSON.stringify(signedIn).includes('Fresh login retained'),
        ],
        expected: [[true, true], 1, 1, 0, 2, true],
      })
      credentialRun.close()
    } finally {
      await task?.close()
      await setup?.close()
      if (browser && browser.exitCode === null) {
        browser.kill('SIGTERM')
        await Promise.race([once(browser, 'exit'), delay(5000)])
        if (browser.exitCode === null) browser.kill('SIGKILL')
      }
      for (const server of servers) {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
      await rm(root, { recursive: true, force: true })
    }
  },
)
