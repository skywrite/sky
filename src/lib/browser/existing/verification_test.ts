import { assert, test } from '#test'
import { McpError, type McpClient, type McpToolResult } from '../mcp/client.ts'
import { verifyExistingBrowser } from './verification.ts'

const TOKEN = 'mock_Atlas_extension_token_1234567890'

test('connection verification stays in the worker and closes its owned browser before saving', async () => {
  let closed = 0
  const requests: unknown[] = []
  const client: Pick<McpClient, 'callTool' | 'close'> = {
    async callTool(name, args, options) {
      requests.push([name, args, options?.timeoutMs])
      return { content: [], isError: false, structuredContent: { browser: 'brave', profileDirName: 'Profile 2' } }
    },
    async close() {
      closed++
    },
  }
  const verified = await verifyExistingBrowser(
    `PLAYWRIGHT_MCP_EXTENSION_TOKEN=${TOKEN}`,
    { browser: 'brave' },
    async () => client,
  )
  assert({
    given: 'an explicit browser setup request',
    should: 'use one bounded host-only operation, return only profile metadata, and close the worker',
    actual: [requests, verified, JSON.stringify(verified).includes(TOKEN), closed],
    expected: [
      [['sky_verify_existing_browser', { token: TOKEN, settings: { browser: 'brave' } }, 45_000]],
      { browser: 'brave', profileDirName: 'Profile 2' },
      false,
      1,
    ],
  })
})

test('failed and malformed connection checks close the worker and never reflect secrets', async () => {
  let closed = 0
  const messages: string[] = []
  for (const reply of [
    new Error(TOKEN),
    new McpError(`Brave connection failed: ${TOKEN}`, -32010),
    { content: [], isError: true },
    { content: [], isError: false, structuredContent: { browser: 'brave', profileDirName: 'Profile 3' } },
  ]) {
    const client: Pick<McpClient, 'callTool' | 'close'> = {
      async callTool() {
        if (reply instanceof Error) throw reply
        return reply as McpToolResult
      },
      async close() {
        closed++
      },
    }
    const failure = await verifyExistingBrowser(
      TOKEN,
      { browser: 'brave', profileDirName: 'Profile 2' },
      async () => client,
    ).then(
      () => '',
      (error: Error) => error.message,
    )
    messages.push(failure)
  }
  assert({
    given: 'a failed handshake, an extension error, a failed operation, and a different profile',
    should: 'reject every candidate, retain useful errors, redact the token, and always release the worker',
    actual: [messages.every(Boolean), messages.some((message) => message.includes(TOKEN)), messages[1], closed],
    expected: [true, false, 'Brave connection failed: [redacted]', 4],
  })
})
