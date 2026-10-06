import { assert, test } from '#test'
import type { McpToolResult } from '../mcp/client.ts'
import { RecoveringBrowserSession, type RecoverableBrowserSession } from './recovery.ts'

const result = (text: string): McpToolResult => ({ isError: false, content: [{ type: 'text', text }] })
const timeout: McpToolResult = {
  isError: true,
  content: [{ type: 'text', text: 'The browser stopped responding.' }],
  structuredContent: { kind: 'browser_timeout' },
}

test('browser recovery checks the resulting page without repeating an uncertain click', async () => {
  const calls: string[] = []
  let submissions = 0
  const initial: RecoverableBrowserSession = {
    listTools: async () => [],
    recoveryUrl: () => 'https://atlas.example/documents',
    close: async () => {
      calls.push('old:close')
    },
    callTool: async () => {
      submissions++
      return timeout
    },
  }
  const replacement: RecoverableBrowserSession = {
    ...initial,
    close: async () => {
      calls.push('new:close')
    },
    callTool: async (name, args) => {
      calls.push(`${name}${args.url ? ` ${args.url}` : ''}`)
      return result('The document request already completed.')
    },
  }
  const browser = new RecoveringBrowserSession(initial, async () => replacement)
  const click = await browser.callTool('browser_click', { target: 'e1' })
  const inspected = await browser.callTool('browser_snapshot', {})
  await browser.close()
  assert({
    given: 'a document click committed before the browser stopped answering',
    should: 'retire the old page, reconnect and inspect without replaying the click',
    actual: [submissions, click.isError, inspected.isError, calls],
    expected: [
      1,
      true,
      false,
      ['old:close', 'browser_navigate https://atlas.example/documents', 'browser_snapshot', 'new:close'],
    ],
  })
})

test('a stalled snapshot can be safely read again after reconnecting', async () => {
  const calls: string[] = []
  const initial: RecoverableBrowserSession = {
    listTools: async () => [],
    recoveryUrl: () => 'https://atlas.example/documents',
    close: async () => {},
    callTool: async () => timeout,
  }
  const browser = new RecoveringBrowserSession(initial, async () => ({
    ...initial,
    callTool: async (name) => {
      calls.push(name)
      return result('- Page URL: https://atlas.example/documents\nDocuments ready')
    },
  }))
  const snapshot = await browser.callTool('browser_snapshot', {})
  assert({
    given: 'a snapshot timed out without sending any input',
    should: 'return a fresh readable page with the recovery notice',
    actual: [snapshot.isError, JSON.stringify(snapshot).includes('Documents ready'), calls],
    expected: [false, true, ['browser_navigate', 'browser_snapshot']],
  })
})

test('cancellation during browser recovery closes the replacement without navigating', async () => {
  let finish!: (session: RecoverableBrowserSession) => void
  let creating!: () => void
  const started = new Promise<void>((resolve) => {
    creating = resolve
  })
  let navigated = 0
  let closed = 0
  const initial: RecoverableBrowserSession = {
    listTools: async () => [],
    recoveryUrl: () => 'https://atlas.example/documents',
    close: async () => {},
    callTool: async () => timeout,
  }
  const browser = new RecoveringBrowserSession(initial, () => {
    creating()
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const pending = browser.callTool('browser_mouse_wheel', { deltaY: 500, deltaX: 0 })
  await started
  await browser.close()
  finish({
    ...initial,
    close: async () => {
      closed++
    },
    callTool: async () => {
      navigated++
      return result('ok')
    },
  })
  await pending
  assert({
    given: 'the run is cancelled while a new browser connection is opening',
    should: 'close that connection and leave the website untouched',
    actual: [closed, navigated],
    expected: [1, 0],
  })
})

test('repeated browser stalls have a finite recovery budget', async () => {
  let connections = 0
  const session: RecoverableBrowserSession = {
    listTools: async () => [],
    recoveryUrl: () => 'https://atlas.example/documents',
    close: async () => {},
    callTool: async (name) => (name === 'browser_navigate' ? result('opened') : timeout),
  }
  const browser = new RecoveringBrowserSession(session, async () => {
    connections++
    return { ...session }
  })
  for (let n = 0; n < 4; n++) await browser.callTool('browser_mouse_wheel', { deltaY: 500, deltaX: 0 })
  assert({
    given: 'a browser that never recovers',
    should: 'stop reconnecting after two attempts',
    actual: connections,
    expected: 2,
  })
})
