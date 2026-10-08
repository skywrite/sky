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

interface SyntheticChrome {
  tabs: {
    getCurrent(): Promise<{ id: number; windowId: number }>
    query(options: { windowId?: number; active?: boolean; url?: string }): Promise<{ id: number }[]>
    group(options: { tabIds: number[] }): Promise<number>
    update(id: number, options: { active: boolean }): Promise<unknown>
  }
  tabGroups: {
    update(id: number, options: { title: string }): Promise<unknown>
  }
  windows: {
    get(id: number): Promise<{ id: number; focused: boolean }>
    getAll(): Promise<{ id: number; focused: boolean }[]>
    update(id: number, options: { focused: boolean }): Promise<unknown>
  }
}

async function savedGroupShortcuts(root: string, pid: number): Promise<{ sky: number; original: number }> {
  const script = path.join(root, 'saved-groups.swift')
  await writeFile(
    script,
    `import ApplicationServices
import Foundation

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

func labels(_ element: AXUIElement, depth: Int = 0) -> [String] {
    guard depth < 25 else { return [] }
    let role = attribute(element, "AXRole") as? String ?? ""
    if role == "AXWebArea" { return [] }
    var result: [String] = []
    if role == "AXButton" {
        let values = ["AXTitle", "AXDescription", "AXHelp"].compactMap { attribute(element, $0) as? String }
        if let label = values.first(where: { $0.contains(" group - ") }) { result.append(label) }
    }
    for child in attribute(element, "AXChildren") as? [AXUIElement] ?? [] {
        result += labels(child, depth: depth + 1)
    }
    return result
}

guard AXIsProcessTrusted(), let pid = Int32(CommandLine.arguments[1]) else {
    fatalError("The saved-group UI test requires macOS Accessibility access.")
}
let application = AXUIElementCreateApplication(pid)
let windows = attribute(application, "AXWindows") as? [AXUIElement] ?? []
let counts = windows.map { window -> [String: Int] in
    let items = labels(window)
    return ["sky": items.filter { $0.contains("Playwright · Sky group - ") }.count,
            "original": items.filter { $0.contains(" Atlas group - ") }.count]
}
let result = ["sky": counts.map { $0["sky"]! }.max() ?? 0,
              "original": counts.map { $0["original"]! }.max() ?? 0]
print(String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
`,
  )
  const result = await runCommand(
    'swift',
    ['-module-cache-path', path.join(root, 'swift-cache'), script, String(pid)],
    {
      timeout: 20000,
    },
  )
  if (!result.success) throw new Error('The saved-group UI probe could not run. Check macOS Accessibility access.')
  return JSON.parse(result.stdout)
}

// Opt in with an unpacked official extension and a locally installed Brave.
// Every browser profile, login, document, and server in this test is synthetic.
test(
  {
    name: 'existing Brave retains sessions, scopes files and keeps background input in its own window',
    ignore: process.env.SKY_EXTENSION_TESTS !== '1',
    timeout: 120000,
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
        if (request.url === '/profile.js') {
          response.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Content-Disposition': 'attachment; filename="profile.js"',
          })
          response.end(
            'fetch("/profile.json").then(r=>r.json()).then(p=>{document.getElementById("details").innerHTML="<h2>About</h2><p>"+p.about+"</p><h2>Experience</h2><p>"+p.experience+"</p>"})',
          )
          return
        }
        if (request.url === '/profile.css') {
          response.writeHead(200, {
            'Content-Type': 'text/css',
            'Content-Disposition': 'attachment; filename="profile.css"',
          })
          response.end('#details { color: rgb(12, 34, 56) }')
          return
        }
        if (request.url === '/profile.json') {
          response.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="profile.json"',
          })
          response.end(JSON.stringify({ about: 'Research lead', experience: 'Atlas engineer' }))
          return
        }
        if (request.url === '/profile') {
          response.setHeader('Content-Type', 'text/html')
          response.end(
            '<title>Jane Doe | Atlas</title><link rel="stylesheet" href="/profile.css"><main><h1>Jane Doe</h1><div id="details">Loading profile sections</div></main><script src="/profile.js"></script>',
          )
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
      preferences.auto_pin_new_tab_groups = true
      preferences.bookmark_bar = { ...preferences.bookmark_bar, show_on_all_tabs: true }
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
      const originalControl = attached.context.pages().find((page) => page.url().startsWith('chrome-extension:'))!
      await originalControl.evaluate(async (url) => {
        const chrome = (globalThis as unknown as { chrome: SyntheticChrome }).chrome
        const original = await chrome.tabs.query({ url })
        if (original.length !== 1) throw new Error('Missing synthetic original tab')
        const groupId = await chrome.tabs.group({ tabIds: [original[0]!.id] })
        await chrome.tabGroups.update(groupId, { title: 'Atlas' })
      }, `${origin}/seed`)
      if (process.env.SKY_BROWSER_UI_TESTS === '1') {
        assert({
          given: 'the synthetic original group and the first Sky connection',
          should: 'show saved-group shortcuts so the cleanup assertion can detect leftover groups',
          actual: await savedGroupShortcuts(root, browser.pid!),
          expected: { sky: 1, original: 1 },
        })
      }
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
      await task.close()
      task = undefined

      const background = await connectExistingBrowser(
        token,
        { browser: 'brave' },
        { executablePath, userDataDir: profile, homeDir: root, background: true },
      )
      task = await PrivateBrowserSession.launch({
        filesDir,
        profileDir: path.join(root, 'unused-profile'),
        attached: background,
        broker: broker(),
      })
      const control = background.context.pages().find((page) => page.url().startsWith('chrome-extension:'))!
      // This API is used only in the temporary synthetic extension profile.
      const windows = () =>
        control.evaluate(async () => {
          const chrome = (globalThis as unknown as { chrome: SyntheticChrome }).chrome
          const self = await chrome.tabs.getCurrent()
          const current = await chrome.windows.get(self.windowId)
          const all = await chrome.windows.getAll()
          const other = all.find((window) => window.id !== self.windowId)!
          const selected = await chrome.tabs.query({ windowId: other.id, active: true })
          return {
            taskWindowId: self.windowId,
            focused: current.focused,
            other: { id: other.id, focused: other.focused, tab: selected[0]!.id },
          }
        })
      await control.evaluate(async () => {
        const chrome = (globalThis as unknown as { chrome: SyntheticChrome }).chrome
        const self = await chrome.tabs.getCurrent()
        const all = await chrome.windows.getAll()
        const other = all.find((window) => window.id !== self.windowId)!
        await chrome.windows.update(other.id, { focused: true })
      })
      const before = await windows()
      const existingFiles = (await readdir(filesDir)).sort()
      await task.callTool('browser_navigate', { url: `${origin}/profile` })
      await background.page.getByRole('heading', { name: 'Experience' }).waitFor({ timeout: 5000 })
      const loadedProfile = await task.callTool('browser_snapshot', {})
      assert({
        given: 'a background profile whose scripts, styles and API data have attachment headers',
        should: 'load the profile sections without collecting page resources as downloads or changing focus',
        actual: [
          JSON.stringify(loadedProfile).includes('Atlas engineer'),
          await background.page.locator('#details').evaluate((element) => getComputedStyle(element).color),
          (await readdir(filesDir)).sort(),
          await windows(),
        ],
        expected: [true, 'rgb(12, 34, 56)', existingFiles, before],
      })
      await task.callTool('browser_navigate', { url: origin })
      const session = await task.callTool('browser_snapshot', {})
      await background.page.evaluate(() => {
        document.body.innerHTML =
          '<button onclick="this.textContent=\'Clicked\'">Click</button><label>Note<input></label><main style="height:3000px">Jane Doe</main>'
      })
      const controls = (await task.callTool('browser_snapshot', {})).content
        .flatMap((part) => (part.type === 'text' && 'text' in part ? [part.text] : []))
        .join('\n')
      const clickRef = controls.match(/button "Click" \[ref=([^\]]+)\]/)?.[1]
      const noteRef = controls.match(/textbox "Note" \[ref=([^\]]+)\]/)?.[1]
      if (!clickRef || !noteRef) throw new Error('Missing synthetic input controls')
      await control.evaluate(async () => {
        const chrome = (globalThis as unknown as { chrome: SyntheticChrome }).chrome
        // Deactivate the task tab without focusing its window. Input must
        // reactivate the task tab while the original window remains focused.
        await chrome.tabs.update((await chrome.tabs.getCurrent()).id, { active: true })
      })
      const clicked = await task.callTool('browser_click', { target: clickRef })
      const typed = await task.callTool('browser_type', { target: noteRef, text: 'Atlas' })
      const backgroundScrolled = await task.callTool('browser_mouse_wheel', { deltaX: 0, deltaY: 500 })
      await background.page.waitForFunction(() => scrollY > 0)
      const after = await windows()
      assert({
        given: 'a task in its own existing-Brave window while the person uses another window',
        should: 'retain login, click, type and scroll without changing the focused window or its selected tab',
        actual: [
          JSON.stringify(session).includes('Session retained'),
          clicked.isError,
          typed.isError,
          backgroundScrolled.isError,
          await background.page.getByRole('button').textContent(),
          await background.page.getByRole('textbox').inputValue(),
          after,
        ],
        expected: [true, false, false, false, 'Clicked', 'Atlas', { ...before, focused: false }],
      })
      const toolNames = (await task.listTools()).map((tool) => tool.name)
      const shown = await task.callTool('sky_show_browser', {})
      assert({
        given: 'the import host requests a real verification handoff',
        should: 'show its owned window while keeping window controls out of model tools',
        actual: [shown.isError, (await windows()).focused, toolNames.includes('sky_show_browser')],
        expected: [false, true, false],
      })
      await task.close()
      task = undefined
      const connecting = new AbortController()
      const cancelConnection = setTimeout(() => connecting.abort(), 1)
      let connectionCancelled = false
      try {
        const interrupted = await connectExistingBrowser(
          token,
          { browser: 'brave' },
          { executablePath, userDataDir: profile, homeDir: root, background: true, signal: connecting.signal },
        )
        await interrupted.close()
      } catch {
        connectionCancelled = true
      } finally {
        clearTimeout(cancelConnection)
      }
      const probe = await connectExistingBrowser(
        token,
        { browser: 'brave' },
        { executablePath, userDataDir: profile, homeDir: root },
      )
      try {
        const inspector = probe.context.pages().find((page) => page.url().startsWith('chrome-extension:'))!
        assert({
          given: 'cancellation while opening a background connection',
          should: 'remove its connection window as well as a completed task window',
          actual: [
            connectionCancelled,
            await inspector.evaluate(async () => {
              const chrome = (globalThis as unknown as { chrome: SyntheticChrome }).chrome
              return (await chrome.windows.getAll()).length
            }),
          ],
          expected: [true, 1],
        })
        const retainedWindows = await inspector.evaluate(
          async ({ taskWindowId, otherWindowId }) => {
            const chrome = (globalThis as unknown as { chrome: SyntheticChrome }).chrome
            const all = await chrome.windows.getAll()
            return [all.some((window) => window.id === taskWindowId), all.some((window) => window.id === otherWindowId)]
          },
          { taskWindowId: before.taskWindowId, otherWindowId: before.other.id },
        )
        assert({
          given: 'the background task finished and disconnected',
          should: 'close its task window and leave the original browser window running',
          actual: [retainedWindows, browser.exitCode === null],
          expected: [[false, true], true],
        })
      } finally {
        await probe.close()
      }
      // Closed saved groups are absent from chrome.tabGroups.query. Opt in to
      // inspect only this temporary profile's actual bookmarks bar on macOS.
      if (process.env.SKY_BROWSER_UI_TESTS === '1') {
        assert({
          given: 'foreground tasks, cancellation and a completed background task',
          should: 'leave no saved Sky group shortcuts while preserving the original saved group',
          actual: await savedGroupShortcuts(root, browser.pid!),
          expected: { sky: 0, original: 1 },
        })
      }
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
