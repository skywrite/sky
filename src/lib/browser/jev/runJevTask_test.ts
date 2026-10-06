import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import type { McpToolResult } from '../mcp/client.ts'
import { McpError } from '../mcp/client.ts'
import type { AdviseOptions, AdviseResult } from './advisor.ts'
import type { AskJev, LooseAnswer, LooseResult } from './decide.ts'
import { type BrowserSession, runJevTask, UNCHANGED_LIMIT } from './runJevTask.ts'

// A scripted browser and a scripted Jev drive the loop through the two
// portal scenes: a sign-in page, then the documents page with a 2024 and
// a 2025 form. The loop's gates, not the models, are under test.

const SIGN_IN = `### Page
- Page URL: http://atlas.test/
- Page Title: Atlas Brokerage — Sign in
### Snapshot
\`\`\`yaml
- generic [ref=e1] [box=0,0,1280,900]:
  - heading "Sign in to Atlas Brokerage" [level=1] [ref=e2] [box=8,8,600,37]
  - text: Username
  - textbox "Username" [ref=e3] [box=8,60,200,20]
  - text: Password
  - textbox "Password" [ref=e4] [box=8,90,200,20]
  - button "Sign in" [ref=e5] [box=8,120,60,20]
\`\`\``
const DOCUMENTS = `### Page
- Page URL: http://atlas.test/documents
- Page Title: Atlas Brokerage
### Snapshot
\`\`\`yaml
- generic [ref=e1] [box=0,0,1280,900]:
  - heading "Atlas Brokerage — Documents" [level=1] [ref=e2] [box=8,8,600,37]
  - list [ref=e6] [box=8,60,600,60]:
    - listitem [ref=e7] [box=8,60,600,20]:
      - text: "Tax year 2024:"
      - link "Download" [ref=e8] [box=120,60,60,20]
    - listitem [ref=e9] [box=8,80,600,20]:
      - text: "Tax year 2025:"
      - link "Download" [ref=e10] [box=120,80,60,20]
\`\`\``

const text = (t: string): McpToolResult => ({ content: [{ type: 'text', text: t }], isError: false })
const pick = (choice: string, others: string[] = []): LooseAnswer => ({
  choice,
  probabilities:
    others.length === 0
      ? { [choice]: 1 }
      : { [choice]: 0.9, ...Object.fromEntries(others.map((o) => [o, 0.1 / others.length])) },
  confidence: 0.9,
})
const quiet = { needs_person: { noul: 0.05 }, done: { noul: 0.02 }, risky: { noul: 0.05 } }
const reply = (answers: Record<string, LooseAnswer>, tokens = 900): LooseResult => ({
  model: 'jev-test',
  answers,
  usage: { input_tokens: tokens, output_tokens: 0 },
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-jev-task-test-'))
  const filesDir = path.join(root, 'files')
  await writeFile(path.join(root, '.keep'), '')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(filesDir)
  return { root, filesDir, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('Jev checks submitted logins and ends declined attempts instead of waiting on them', async () => {
  for (const status of ['submitted', 'navigated', 'declined', 'needs_user'] as const) {
    const { root, filesDir, cleanup } = await fixture()
    const calls: string[] = []
    let signedIn = false
    let asks = 0
    const browser: BrowserSession = {
      callTool: async (name) => {
        calls.push(name)
        if (name === 'browser_snapshot') return text(signedIn ? DOCUMENTS : SIGN_IN)
        if (name === 'sign_in') {
          signedIn = status === 'submitted' || status === 'navigated'
          return text(JSON.stringify({ status }))
        }
        return text('ok')
      },
      close: async () => {
        calls.push('close')
      },
    }
    try {
      const result = await runJevTask({
        objective: 'Open https://atlas.example and view my account.',
        taskDir: root,
        filesDir,
        browser,
        privateSignIn: true,
        onNeedsYou: async () => {
          asks++
          return false
        },
        ask: async () =>
          signedIn
            ? reply({ operation: pick('done'), ...quiet, done: { noul: 0.96 } })
            : reply({ operation: pick('ask_person'), ...quiet, needs_person: { noul: 0.98 } }),
      })
      assert({
        given: `private sign-in ${status}`,
        should: 'check the next page after submission and hand off only an available verification step',
        actual: [calls.filter((name) => name === 'sign_in').length, asks, result.outcome, calls.at(-1)],
        expected: [1, status === 'needs_user' ? 1 : 0, signedIn ? 'done' : 'stopped', 'close'],
      })
    } finally {
      await cleanup()
    }
  }
})

test('a failed sign-in returns its reason, closes the browser, and never waits for manual sign-in', async () => {
  for (const reason of ['no_matching_login', 'page_changed', 'provider_unavailable', 'approval_unavailable']) {
    const { root, filesDir, cleanup } = await fixture()
    let asks = 0
    let closed = false
    const secret = 'mock-provider-error-password'
    try {
      const result = await runJevTask({
        objective: 'Open https://atlas.example and view my account.',
        taskDir: root,
        filesDir,
        privateSignIn: true,
        browser: {
          callTool: async (name) =>
            text(
              name === 'sign_in'
                ? JSON.stringify({
                    status: reason.endsWith('_unavailable') ? 'unavailable' : 'needs_user',
                    reason,
                    message: secret,
                  })
                : SIGN_IN,
            ),
          close: async () => {
            closed = true
          },
        },
        onNeedsYou: async () => {
          asks++
          return false
        },
        ask: async () => reply({ operation: pick('ask_person'), ...quiet, needs_person: { noul: 0.98 } }),
      })
      assert({
        given: reason,
        should: 'finish with a safe site-specific failure, not another handoff or a raw provider error',
        actual: [
          result.outcome,
          asks,
          closed,
          result.reason?.includes('http://atlas.test'),
          JSON.stringify(result).includes(secret),
        ],
        expected: ['blocked', 0, true, true, false],
      })
    } finally {
      await cleanup()
    }
  }
})

test('the loop asks the person on a sign-in page, then clicks the 2025 form and finishes', async () => {
  const { root, filesDir, cleanup } = await fixture()
  const calls: string[] = []
  let signedIn = false
  const browser: BrowserSession = {
    serverInfo: { name: 'Scripted', version: '0' },
    async callTool(name, args) {
      calls.push(`${name}${args.target ? ` ${args.target}` : ''}`)
      if (name === 'browser_snapshot') return text(signedIn ? DOCUMENTS : SIGN_IN)
      if (name === 'browser_click' && args.target === 'e10') {
        await writeFile(path.join(filesDir, 'Atlas-2025.pdf'), '%PDF')
        return text('### Events\n- Downloaded file Atlas-2025.pdf to "./Atlas-2025.pdf"')
      }
      return text('ok')
    },
    async close() {
      calls.push('close')
    },
  }
  const asks: string[] = []
  const answers: AskJev = async ({ state }) => {
    const s = state as { history: string[]; controls: string[] }
    const downloaded = s.history.some((line) => line.startsWith('Downloaded'))
    const onSignIn = s.controls.some((row) => row.includes('"Password"'))
    if (onSignIn)
      return reply(
        {
          operation: pick('ask_person', ['type']),
          type_target: pick('t0'),
          click_target: pick('t2'),
          needs_person: { noul: 0.97 },
          done: { noul: 0.01 },
          risky: { noul: 0.1 },
        },
        800,
      )
    if (downloaded)
      return reply(
        { operation: pick('done', ['click']), click_target: pick('none'), ...quiet, done: { noul: 0.96 } },
        900,
      )
    return reply({ operation: pick('click', ['done']), click_target: pick('t1', ['t0']), ...quiet }, 900)
  }
  try {
    const result = await runJevTask({
      objective: 'Go to http://atlas.test/ and download my 2025 tax form.',
      ask: answers,
      taskDir: root,
      filesDir,
      browser,
      onNeedsYou: async (message) => {
        asks.push(message)
        signedIn = true
        return true
      },
    })
    assert({
      given: 'a sign-in page then the documents page',
      should: 'ask once, click the 2025 link, and end done with the file listed',
      actual: {
        outcome: result.outcome,
        asks: asks.length,
        askMentionsPage: asks[0]?.includes('Sign in'),
        operations: result.steps.map((s) => s.operation),
        clicked: calls.filter((c) => c.startsWith('browser_click')),
        downloads: result.downloads,
        files: result.files.map((f) => path.basename(f)),
        jev: result.usage.jevRequests,
        closed: calls.at(-1),
      },
      expected: {
        outcome: 'done',
        asks: 1,
        askMentionsPage: true,
        operations: ['ask_person', 'click', 'done'],
        clicked: ['browser_click e10'],
        downloads: ['Atlas-2025.pdf'],
        files: ['Atlas-2025.pdf'],
        jev: 3,
        closed: 'close',
      },
    })
    assert({
      given: 'the report',
      should: 'say done, list the file, and say it was not checked',
      actual: [
        result.report.startsWith('Done.'),
        result.report.includes('Atlas-2025.pdf'),
        result.report.includes('Not checked'),
      ],
      expected: [true, true, true],
    })
  } finally {
    await cleanup()
  }
})

test('a page that stops changing ends the loop as blocked, and done is refused until a download arrives', async () => {
  const { root, filesDir, cleanup } = await fixture()
  const browser: BrowserSession = {
    async callTool(name) {
      if (name === 'browser_snapshot') return text(DOCUMENTS)
      return text('ok')
    },
    async close() {},
  }
  let asked = 0
  const answers: AskJev = async () => {
    asked++
    // First: claims done with nothing downloaded. Then: clicks the 2024 link forever.
    if (asked === 1)
      return reply({ operation: pick('done', ['click']), click_target: pick('none'), ...quiet, done: { noul: 0.9 } }, 1)
    return reply({ operation: pick('click', ['done']), click_target: pick('t0', ['t1']), ...quiet }, 1)
  }
  try {
    const result = await runJevTask({
      objective: 'Go to http://atlas.test/ and download my 2025 tax form.',
      ask: answers,
      taskDir: root,
      filesDir,
      browser,
      onNeedsYou: async () => true,
    })
    assert({
      given: 'a done claim before any download, then clicks that change nothing',
      should: `refuse done once and end blocked after ${UNCHANGED_LIMIT} unchanged pages`,
      actual: { outcome: result.outcome, refused: result.steps[0]?.note, reason: result.reason },
      expected: {
        outcome: 'blocked',
        refused: 'Done refused: the goal asks for a download and no file is in the task folder.',
        reason: `The page did not change after ${UNCHANGED_LIMIT} moves in a row.`,
      },
    })
  } finally {
    await cleanup()
  }
})

test('repeated completion claims cannot finish a download task without a saved file', async () => {
  for (const reported of [false, true]) {
    const { root, filesDir, cleanup } = await fixture()
    try {
      const result = await runJevTask({
        objective: 'Download the tax document from https://atlas.example/documents',
        taskDir: root,
        filesDir,
        onNeedsYou: async () => false,
        browser: {
          callTool: async (name) =>
            text(
              name === 'browser_snapshot'
                ? DOCUMENTS
                : reported
                  ? 'Downloaded file Atlas-2025.pdf to "./Atlas-2025.pdf"'
                  : 'ok',
            ),
          close: async () => {},
        },
        ask: async () => reply({ operation: pick('done'), ...quiet, done: { noul: 0.99 } }),
      })
      assert({
        given: reported ? 'a download event without a saved file' : 'repeated model completion claims',
        should: 'report the missing file instead of successful collection',
        actual: [result.outcome, result.reason, result.files],
        expected: [
          'blocked',
          'No downloaded file was collected into the task folder. Check the browser’s actual download location before retrying.',
          [],
        ],
      })
    } finally {
      await cleanup()
    }
  }
})

test('a browser download collection failure preserves the real save location without repeating the download', async () => {
  const { root, filesDir, cleanup } = await fixture()
  const notice =
    'Brave completed "Atlas.pdf", but Sky could not collect the file from "/mock/Desktop". Check Brave’s Downloads list.'
  let decisions = 0
  try {
    const result = await runJevTask({
      objective: 'Download the document from https://atlas.example/documents',
      taskDir: root,
      filesDir,
      onNeedsYou: async () => false,
      browser: {
        callTool: async () => text(`${DOCUMENTS}\nBrowser download notice: ${notice}`),
        close: async () => {},
      },
      ask: async () => {
        decisions++
        return reply({ operation: pick('done'), ...quiet, done: { noul: 0.99 } })
      },
    })
    assert({
      given: 'a completed native download whose file could not be collected',
      should: 'carry its known location to the parent chat and stop before another download attempt',
      actual: [
        result.outcome,
        result.reason,
        result.report.includes(notice),
        result.history.includes(notice),
        decisions,
      ],
      expected: ['blocked', notice, true, true, 0],
    })
  } finally {
    await cleanup()
  }
})

test('a secret field is never typed by the model, and a missing address stops the task before the browser opens', async () => {
  const { root, filesDir, cleanup } = await fixture()
  const typed: string[] = []
  const browser: BrowserSession = {
    async callTool(name, args) {
      if (name === 'browser_type') typed.push(String(args.text))
      if (name === 'browser_snapshot') return text(SIGN_IN)
      return text('ok')
    },
    async close() {},
  }
  let asked = 0
  const answers: AskJev = async () => {
    asked++
    if (asked === 1)
      return reply(
        { operation: pick('type', ['click']), type_target: pick('t1', ['t0']), click_target: pick('t2'), ...quiet },
        1,
      )
    return reply(
      { operation: pick('blocked', ['type']), type_target: pick('none'), click_target: pick('none'), ...quiet },
      1,
    )
  }
  try {
    const result = await runJevTask({
      objective: 'Go to http://atlas.test/ and sign in.',
      ask: answers,
      taskDir: root,
      filesDir,
      browser,
      typingModel: {} as never,
      typeText: async () => ({ text: 'hunter2', usage: { input: 0, output: 0 } }),
      onNeedsYou: async () => true,
    })
    assert({
      given: 'Jev choosing to type into the Password field',
      should: 'type nothing and say why',
      actual: { typed, note: result.steps[0]?.note, outcome: result.outcome },
      expected: { typed: [], note: 'A secret field is never typed by a model.', outcome: 'blocked' },
    })
    const noAddress = await runJevTask({
      objective: 'Download my tax form.',
      ask: answers,
      taskDir: root,
      filesDir,
      browser,
      onNeedsYou: async () => true,
    }).then(
      () => 'ran',
      (error: unknown) => (error instanceof Error ? error.message : 'other'),
    )
    assert({
      given: 'an objective with no web address',
      should: 'stop with a plain message',
      actual: noAddress,
      expected: 'Say which site to open, with its full address (https://…).',
    })
  } finally {
    await cleanup()
  }
})

test('once the person has answered a page, Jev asking again on that same page runs its next-best move', async () => {
  const { root, filesDir, cleanup } = await fixture()
  const clicked: string[] = []
  const waits: number[] = []
  // A signed-in documents page that Jev keeps reading as a sign-in page.
  const browser: BrowserSession = {
    async callTool(name, args) {
      if (name === 'browser_snapshot') return text(DOCUMENTS)
      if (name === 'browser_wait_for') waits.push(Number(args.time))
      if (name === 'browser_click') {
        clicked.push(String(args.target))
        await writeFile(path.join(filesDir, 'Atlas-2025.pdf'), '%PDF')
        return text('### Events\n- Downloaded file Atlas-2025.pdf to "./Atlas-2025.pdf"')
      }
      return text('ok')
    },
    async close() {},
  }
  let asks = 0
  const answers: AskJev = async ({ state }) => {
    const s = state as { history: string[] }
    if (s.history.some((line) => line.startsWith('Downloaded')))
      return reply({ operation: pick('done', ['click']), click_target: pick('none'), ...quiet, done: { noul: 0.95 } })
    // Always: "ask the person", with click on the 2025 link as the runner-up.
    return reply({
      operation: {
        choice: 'ask_person',
        probabilities: { ask_person: 0.6, click: 0.35, blocked: 0.05 },
        confidence: 0.5,
      },
      click_target: pick('t1', ['t0']),
      needs_person: { noul: 0.9 },
      done: { noul: 0.02 },
      risky: { noul: 0.05 },
    })
  }
  try {
    const result = await runJevTask({
      objective: 'Go to http://atlas.test/ and download my 2025 tax form.',
      ask: answers,
      taskDir: root,
      filesDir,
      browser,
      onNeedsYou: async () => {
        asks++
        return true
      },
    })
    assert({
      given: 'a page the person answered that Jev still reads as needing them',
      should: 'ask once, look twice more, then click the runner-up and finish',
      actual: {
        asks,
        clicked,
        outcome: result.outcome,
        notes: result.steps.map((s) => s.note).filter(Boolean),
        secondLook: waits.includes(3) && waits.includes(5),
      },
      expected: {
        asks: 1,
        clicked: ['e10'],
        outcome: 'done',
        notes: [
          'Asked the person.',
          'Jev asked again on the page the person answered; looked once more.',
          'Jev asked again on the page the person answered; looked once more.',
          'Jev asked for ask_person; the next-best move ran instead.',
        ],
        secondLook: true,
      },
    })
  } finally {
    await cleanup()
  }
})

test('the adviser overrules a needless ask and turns a blocked click into a direct visit', async () => {
  const { root, filesDir, cleanup } = await fixture()
  const calls: string[] = []
  const HOME = DOCUMENTS.replace('Atlas Brokerage — Documents', 'Atlas Brokerage — Home').replace(
    'http://atlas.test/documents',
    'http://atlas.test/home',
  )
  let page: 'home' | 'documents' = 'home'
  const browser: BrowserSession = {
    async callTool(name, args) {
      calls.push(`${name}${args.target ? ` ${args.target}` : args.url ? ` ${args.url}` : ''}`)
      if (name === 'browser_snapshot') return text(page === 'home' ? HOME : DOCUMENTS)
      // On the home page a banner covers the links: clicks fail. A direct visit works.
      if (name === 'browser_click' && page === 'home')
        return {
          content: [{ type: 'text', text: 'Error: <div class="banner"> intercepts pointer events' }],
          isError: true,
        }
      if (name === 'browser_navigate' && String(args.url).endsWith('/documents')) {
        page = 'documents'
        return text('ok')
      }
      if (name === 'browser_click' && args.target === 'e10') {
        await writeFile(path.join(filesDir, 'Atlas-2025.pdf'), '%PDF')
        return text('### Events\n- Downloaded file Atlas-2025.pdf to "./Atlas-2025.pdf"')
      }
      return text('ok')
    },
    async close() {},
  }
  const asks: string[] = []
  const advised: string[] = []
  const answers: AskJev = async ({ state }) => {
    const s = state as { history: string[]; controls: string[]; plan?: string }
    if (s.history.some((line) => line.startsWith('Downloaded')))
      return reply({ operation: pick('done', ['click']), click_target: pick('none'), ...quiet, done: { noul: 0.95 } })
    // On the home page Jev always wants the person; on the documents page it clicks the 2025 link.
    if (page === 'home')
      return reply({
        operation: { choice: 'ask_person', probabilities: { ask_person: 0.7, click: 0.3 }, confidence: 0.6 },
        click_target: pick('t1', ['t0']),
        needs_person: { noul: 0.92 },
        done: { noul: 0.02 },
        risky: { noul: 0.05 },
      })
    return reply({ operation: pick('click', ['done']), click_target: pick('t1', ['t0']), ...quiet })
  }
  const advise = async (options: AdviseOptions): Promise<AdviseResult> => {
    advised.push(options.trigger)
    const base = { usage: { input: 100, output: 20 }, ms: 250 }
    if (options.trigger === 'new_page' && options.table.title.includes('Home'))
      return {
        ...base,
        advice: {
          subgoal: 'Open the 2025 tax form download',
          needsPerson: false,
          reason: 'The page shows the person signed in.',
        },
      }
    if (options.trigger === 'move_failed')
      return {
        ...base,
        advice: {
          subgoal: 'Open the documents page directly',
          needsPerson: false,
          action: { kind: 'navigate', url: 'http://atlas.test/documents' },
          reason: 'A banner intercepts clicks.',
        },
      }
    return { ...base, advice: { subgoal: 'Download the 2025 form', needsPerson: false, reason: 'Documents page.' } }
  }
  try {
    const result = await runJevTask({
      objective: 'Go to http://atlas.test/home and download my 2025 tax form.',
      ask: answers,
      advise,
      taskDir: root,
      filesDir,
      browser,
      onNeedsYou: async (message) => {
        asks.push(message)
        return true
      },
    })
    assert({
      given: 'a signed-in home page Jev reads as needing the person, whose links a banner blocks',
      should: 'never ask, take the next-best click, recover from the blocked click with a direct visit, and finish',
      actual: {
        asks: asks.length,
        advised,
        outcome: result.outcome,
        visited: calls.filter((c) => c.startsWith('browser_navigate')),
        clicked: calls.filter((c) => c.startsWith('browser_click')),
        planned: result.history.filter((line) => line.startsWith('Plan:')).length,
        files: result.files.map((f) => path.basename(f)),
      },
      expected: {
        asks: 0,
        advised: ['new_page', 'move_failed', 'new_page'],
        outcome: 'done',
        visited: ['browser_navigate http://atlas.test/home', 'browser_navigate http://atlas.test/documents'],
        clicked: ['browser_click e10', 'browser_click e10'],
        planned: 3,
        files: ['Atlas-2025.pdf'],
      },
    })
  } finally {
    await cleanup()
  }
})

test('a browser server that dies mid-move is started again on the same page, once', async () => {
  const { root, filesDir, cleanup } = await fixture()
  const events: string[] = []
  const session = (name: string, dies: boolean): BrowserSession => ({
    serverInfo: { name, version: '0' },
    async callTool(tool, args) {
      events.push(`${name}:${tool}${args.url ? ` ${args.url}` : ''}`)
      if (tool === 'browser_snapshot') return text(DOCUMENTS)
      if (tool === 'browser_click' && dies) throw new McpError('The browser server stopped (exit code 1)')
      if (tool === 'browser_click' && args.target === 'e10') {
        await writeFile(path.join(filesDir, 'Atlas-2025.pdf'), '%PDF')
        return text('### Events\n- Downloaded file Atlas-2025.pdf to "./Atlas-2025.pdf"')
      }
      return text('ok')
    },
    async close() {
      events.push(`${name}:close`)
    },
  })
  const answers: AskJev = async ({ state }) => {
    const s = state as { history: string[] }
    if (s.history.some((line) => line.startsWith('Downloaded')))
      return reply({ operation: pick('done', ['click']), click_target: pick('none'), ...quiet, done: { noul: 0.95 } })
    return reply({ operation: pick('click', ['done']), click_target: pick('t1', ['t0']), ...quiet })
  }
  try {
    const result = await runJevTask({
      objective: 'Go to http://atlas.test/documents and download my 2025 tax form.',
      ask: answers,
      taskDir: root,
      filesDir,
      browser: session('first', true),
      launch: async () => session('second', false),
      onNeedsYou: async () => true,
    })
    assert({
      given: 'a first server that dies on the click',
      should: 'start a second, return to the page, click again there, and finish',
      actual: {
        outcome: result.outcome,
        restarted: result.history.some((line) =>
          line.startsWith(
            'The browser server stopped during browser_click; started it again at http://atlas.test/documents',
          ),
        ),
        secondNavigated: events.includes('second:browser_navigate http://atlas.test/documents'),
        secondClicked: events.filter((e) => e === 'second:browser_click').length,
        closedLast: events.at(-1),
      },
      expected: {
        outcome: 'done',
        restarted: true,
        secondNavigated: true,
        secondClicked: 1,
        closedLast: 'second:close',
      },
    })
  } finally {
    await cleanup()
  }
})

test('a page that changes during adviser reasoning is inspected again before any click', async () => {
  const { root, filesDir, cleanup } = await fixture()
  const home = DOCUMENTS.replace('Documents', 'Home').replaceAll('e10', 'e99')
  let page = home
  let staleClicks = 0
  let downloaded = false
  const browser: BrowserSession = {
    callTool: async (name, args) => {
      if (name === 'browser_snapshot') return text(page)
      if (name === 'browser_click') {
        if (args.target === 'e99') staleClicks++
        else {
          downloaded = true
          await writeFile(path.join(filesDir, 'Atlas-2025.pdf'), '%PDF')
          return text('Downloaded file Atlas-2025.pdf to "./Atlas-2025.pdf"')
        }
      }
      return text('ok')
    },
    close: async () => {},
  }
  try {
    const result = await runJevTask({
      objective: 'Download the tax document from https://atlas.example/documents',
      taskDir: root,
      filesDir,
      browser,
      onNeedsYou: async () => false,
      advise: async () => {
        const changed = page === home
        page = DOCUMENTS
        return {
          ms: 0,
          usage: { input: 0, output: 0 },
          advice: {
            subgoal: 'Download the tax form',
            needsPerson: false,
            reason: 'Documents are available',
            ...(changed ? { action: { kind: 'click' as const, index: 1 } } : {}),
          },
        }
      },
      ask: async () =>
        reply(
          downloaded
            ? { operation: pick('done', ['click']), click_target: pick('none'), ...quiet, done: { noul: 0.95 } }
            : { operation: pick('click', ['done']), click_target: pick('t1', ['t0']), ...quiet },
        ),
    })
    assert({
      given: 'the site replaces its controls while the adviser is choosing a move',
      should: 'discard the stale move and finish from a fresh page without asking the person',
      actual: [staleClicks, downloaded, result.outcome],
      expected: [0, true, 'done'],
    })
  } finally {
    await cleanup()
  }
})

test('a view that goes blank after a move is recovered: the task’s tab is selected again, or its last page reopened', async () => {
  const { root, filesDir, cleanup } = await fixture()
  const TABS_WITH_OURS =
    '### Open tabs\n- 0: (current) [](about:blank)\n- 1: [Atlas Brokerage](http://atlas.test/documents)\n'
  const BLANK =
    '### Page\n- Page URL: about:blank\n- Page Title: \n### Snapshot\n```yaml\n- generic [ref=e1] [box=0,0,1280,900]\n```'
  for (const ourTabStillOpen of [true, false]) {
    const calls: string[] = []
    let blankNext = false
    let selected = false
    let reopened = false
    const browser: BrowserSession = {
      async callTool(name, args) {
        calls.push(
          `${name}${args.action ? ` ${args.action}` : ''}${args.index !== undefined ? ` ${args.index}` : ''}${args.url ? ` ${args.url}` : ''}`,
        )
        if (name === 'browser_snapshot') {
          if (blankNext && !selected && !reopened) return text(BLANK)
          return text(DOCUMENTS)
        }
        if (name === 'browser_tabs' && args.action === 'list')
          return text(ourTabStillOpen ? TABS_WITH_OURS : '### Open tabs\n- 0: (current) [](about:blank)\n')
        if (name === 'browser_tabs' && args.action === 'select') {
          selected = true
          return text('ok')
        }
        if (name === 'browser_navigate') {
          if (blankNext) reopened = true
          return text('ok')
        }
        if (name === 'browser_click' && args.target === 'e10') {
          blankNext = true // the click starts a download in a popup; our view goes blank
          if (!selected && !reopened) return text('ok')
          await writeFile(path.join(filesDir, 'Atlas-2025.pdf'), '%PDF')
          return text('### Events\n- Downloaded file Atlas-2025.pdf to "./Atlas-2025.pdf"')
        }
        return text('ok')
      },
      async close() {},
    }
    const answers: AskJev = async ({ state }) => {
      const s = state as { history: string[] }
      if (s.history.some((line) => line.startsWith('Downloaded')))
        return reply({ operation: pick('done', ['click']), click_target: pick('none'), ...quiet, done: { noul: 0.95 } })
      return reply({ operation: pick('click', ['done']), click_target: pick('t1', ['t0']), ...quiet })
    }
    const result = await runJevTask({
      objective: 'Go to http://atlas.test/documents and download my 2025 tax form.',
      ask: answers,
      taskDir: root,
      filesDir,
      browser,
      onNeedsYou: async () => true,
    })
    assert({
      given: ourTabStillOpen
        ? 'a blank view while the task’s tab is still open elsewhere'
        : 'a blank view with the task’s tab gone',
      should: ourTabStillOpen
        ? 'select the task’s tab, click again, and finish'
        : 'reopen the last page in the tab at hand, click again, and finish',
      actual: {
        outcome: result.outcome,
        recovered: result.history.find((line) => line.startsWith('The view went blank')),
        tabMoves: calls.filter((c) => c.startsWith('browser_tabs')),
        reopened: calls.filter((c) => c === 'browser_navigate http://atlas.test/documents').length,
      },
      expected: {
        outcome: 'done',
        recovered: ourTabStillOpen
          ? 'The view went blank after the last move; went back to the task’s tab.'
          : 'The view went blank after the last move; opened http://atlas.test/documents again.',
        tabMoves: ourTabStillOpen ? ['browser_tabs list', 'browser_tabs select 1'] : ['browser_tabs list'],
        reopened: ourTabStillOpen ? 1 : 2,
      },
    })
  }
  await cleanup()
})

test('when the adviser cannot be reached, Jev’s own judgment stands: the person is asked on a sign-in page', async () => {
  const { root, filesDir, cleanup } = await fixture()
  let signedIn = false
  const browser: BrowserSession = {
    async callTool(name, args) {
      if (name === 'browser_snapshot') return text(signedIn ? DOCUMENTS : SIGN_IN)
      if (name === 'browser_click' && args.target === 'e10') {
        await writeFile(path.join(filesDir, 'Atlas-2025.pdf'), '%PDF')
        return text('### Events\n- Downloaded file Atlas-2025.pdf to "./Atlas-2025.pdf"')
      }
      return text('ok')
    },
    async close() {},
  }
  const asks: string[] = []
  const answers: AskJev = async ({ state }) => {
    const s = state as { history: string[]; controls: string[] }
    if (s.history.some((line) => line.startsWith('Downloaded')))
      return reply({ operation: pick('done', ['click']), click_target: pick('none'), ...quiet, done: { noul: 0.95 } })
    if (s.controls.some((row) => row.includes('"Password"')))
      return reply({
        operation: pick('ask_person', ['type']),
        type_target: pick('t0'),
        click_target: pick('t2'),
        needs_person: { noul: 0.96 },
        done: { noul: 0.01 },
        risky: { noul: 0.1 },
      })
    return reply({ operation: pick('click', ['done']), click_target: pick('t1', ['t0']), ...quiet })
  }
  const down = async (): Promise<AdviseResult> => ({
    advice: {
      subgoal: '',
      needsPerson: false,
      failed: true,
      reason: 'The adviser failed: unable to get local issuer certificate',
    },
    usage: { input: 0, output: 0 },
    ms: 40,
  })
  try {
    const result = await runJevTask({
      objective: 'Go to http://atlas.test/ and download my 2025 tax form.',
      ask: answers,
      advise: down,
      taskDir: root,
      filesDir,
      browser,
      onNeedsYou: async (message) => {
        asks.push(message)
        signedIn = true
        return true
      },
    })
    assert({
      given: 'an adviser that fails on every reading and Jev asking for the person on the sign-in page',
      should: 'ask the person once, never overrule Jev with a failed reading, and finish',
      actual: {
        asks: asks.length,
        outcome: result.outcome,
        plans: result.history.filter((l) => l.startsWith('Plan:')).length,
      },
      expected: { asks: 1, outcome: 'done', plans: 0 },
    })
  } finally {
    await cleanup()
  }
})

test('four download links sharing one script address are four downloads, not one repeated', async () => {
  const { root, filesDir, cleanup } = await fixture()
  // Two rows, same label, same non-address href, different dates beside them.
  const TWO_FORMS = `### Page
- Page URL: http://atlas.test/documents
- Page Title: Atlas Brokerage
### Snapshot
\`\`\`yaml
- generic [ref=e1] [box=0,0,1280,900]:
  - heading "Tax forms" [level=1] [ref=e2] [box=8,8,600,37]
  - list [ref=e6] [box=8,60,600,60]:
    - listitem [ref=e7] [box=8,60,600,20]:
      - text: Mar-11-2026
      - link "Download Document" [ref=e8] [box=120,60,60,20]:
        - /url: "#"
    - listitem [ref=e9] [box=8,80,600,20]:
      - text: Mar-11-2026
      - link "Download Document" [ref=e10] [box=120,80,60,20]:
        - /url: "#"
\`\`\``
  const clicked: string[] = []
  const browser: BrowserSession = {
    async callTool(name, args) {
      // The page notes each download, so every look is a page seen for the first time.
      if (name === 'browser_snapshot')
        return text(
          TWO_FORMS.replace('- heading "Tax forms"', `- text: ${clicked.length} downloaded\n  - heading "Tax forms"`),
        )
      if (name === 'browser_click') {
        clicked.push(String(args.target))
        const file = args.target === 'e8' ? 'First-1099.pdf' : 'Second-1099.pdf'
        await writeFile(path.join(filesDir, file), '%PDF')
        return text(`### Events\n- Downloaded file ${file} to "./${file}"`)
      }
      return text('ok')
    },
    async close() {},
  }
  let readings = 0
  const advise = async (): Promise<AdviseResult> => {
    readings++
    const base = { usage: { input: 1, output: 1 }, ms: 1 }
    if (readings === 1)
      return {
        ...base,
        advice: {
          subgoal: 'Download the first form',
          needsPerson: false,
          action: { kind: 'click', index: 0 },
          reason: 'row 1',
        },
      }
    if (readings === 2)
      return {
        ...base,
        advice: {
          subgoal: 'Download the second form',
          needsPerson: false,
          action: { kind: 'click', index: 1 },
          reason: 'row 2',
        },
      }
    return { ...base, advice: { subgoal: 'Both downloaded', needsPerson: false, reason: 'done' } }
  }
  const answers: AskJev = async () =>
    reply({ operation: pick('done', ['click']), click_target: pick('none'), ...quiet, done: { noul: 0.95 } })
  try {
    const result = await runJevTask({
      objective: 'Go to http://atlas.test/documents and download my 2025 tax forms.',
      ask: answers,
      advise,
      taskDir: root,
      filesDir,
      browser,
      onNeedsYou: async () => true,
    })
    assert({
      given: 'the adviser clicking the first row, then the second, both links carrying the same "#" address',
      should: 'download both rather than skip the second as a repeat',
      actual: { clicked, files: result.files.map((f) => path.basename(f)), outcome: result.outcome },
      expected: { clicked: ['e8', 'e10'], files: ['First-1099.pdf', 'Second-1099.pdf'], outcome: 'done' },
    })
  } finally {
    await cleanup()
  }
})
