import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { McpError, type McpToolResult } from '#lib/browser/mcp/client.ts'
import type { PrivateBrowserClient } from '#lib/browser/signIn/run.ts'
import { runBrowserTask } from '#lib/browser/task/runTask.ts'
import { writeJson } from '#lib/jobs/files.ts'
import { assert, test } from '#test'
import { scriptedBrowserModel } from '#test/browserTask.ts'
import type { LinkedInDraft } from './types.ts'
import importLinkedIn from './worker.ts'

const PROFILE = 'https://www.linkedin.com/in/jane-doe-example/'
const source = { url: PROFILE, name: 'Jane Doe', text: 'Research lead', companies: [] }
const draft: LinkedInDraft = {
  url: PROFILE,
  name: 'Jane Doe',
  title: '',
  location: '',
  about: '',
  current: [],
  past: [],
}
const reply = (value: unknown): McpToolResult => ({
  isError: false,
  content: [{ type: 'text', text: JSON.stringify(value) }],
})

async function fixture(work: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-linkedin-job-test-'))
  try {
    await work(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('Person import uses the shared browser task and captures the pinned profile before extraction', async () => {
  await fixture(async (dir) => {
    const calls: string[] = []
    let closed = false
    let extractedAfterClose = false
    let usesSharedConnection = false
    const browser: PrivateBrowserClient = {
      listTools: async () => [
        {
          name: 'browser_navigate',
          inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        },
      ],
      callTool: async (name, args) => {
        calls.push(name)
        if (name === 'sky_read_linkedin_profile') {
          assert({
            given: 'the model calls capture_profile without a URL',
            should: 'read only the profile selected by the import',
            actual: args,
            expected: { url: PROFILE },
          })
          return reply(source)
        }
        return reply('Page opened')
      },
      close: async () => {
        closed = true
      },
    }
    const result = await importLinkedIn(
      { url: PROFILE, progressFile: path.join(dir, 'progress.json'), cancelFile: path.join(dir, 'cancel.json') },
      {
        model: scriptedBrowserModel([
          { name: 'browser_navigate', input: { url: PROFILE } },
          { name: 'capture_profile' },
        ]),
        runTask: async (options) => {
          usesSharedConnection =
            options.privateSignIn === true && options.background === true && !('linkedInProfile' in options)
          await mkdir(options.filesDir, { recursive: true })
          return runBrowserTask({ ...options, browser })
        },
        extract: async (evidence) => {
          extractedAfterClose = closed
          assert({
            given: 'a completed browser task',
            should: 'extract from captured page evidence instead of the task report',
            actual: evidence,
            expected: source,
          })
          return draft
        },
      },
    )
    assert({
      given: 'a LinkedIn import using browser task tools',
      should: 'honor the normal connection path, close before extraction and return an editable draft',
      actual: [usesSharedConnection, calls, extractedAfterClose, result, await readdir(dir)],
      expected: [true, ['browser_navigate', 'sky_read_linkedin_profile'], true, draft, ['progress.json']],
    })
  })
})

test('Person import rejects evidence for another profile and hides browser exception details', async () => {
  await fixture(async (dir) => {
    for (const invalid of [true, false]) {
      let closed = false
      let extracted = false
      let message = ''
      try {
        await importLinkedIn(
          { url: PROFILE, progressFile: path.join(dir, 'progress.json'), cancelFile: path.join(dir, 'cancel.json') },
          {
            model: scriptedBrowserModel([{ name: 'capture_profile' }]),
            runTask: async (options) => {
              await mkdir(options.filesDir, { recursive: true })
              return runBrowserTask({
                ...options,
                browser: {
                  listTools: async () => [],
                  close: async () => {
                    closed = true
                  },
                  callTool: async () => {
                    if (!invalid) throw new Error('Mock sensitive provider diagnostics')
                    return reply({ ...source, url: 'https://www.linkedin.com/in/someone-else-example/' })
                  },
                },
              })
            },
            extract: async () => {
              extracted = true
              throw new Error('Unexpected extraction')
            },
          },
        )
      } catch (error) {
        message = (error as Error).message
      }
      assert({
        given: invalid ? 'evidence for a different profile' : 'a failed browser worker',
        should: 'close the task, skip extraction and explain the affected import safely',
        actual: [
          closed,
          extracted,
          message.includes(PROFILE),
          message.includes('Retry the import'),
          message.includes('diagnostics'),
        ],
        expected: [true, false, true, true, false],
      })
    }
  })
})

test('an extraction failure preserves an editable name after the browser task closes', async () => {
  await fixture(async (dir) => {
    let closed = false
    let closedBeforeExtraction = false
    const result = await importLinkedIn(
      { url: PROFILE, progressFile: path.join(dir, 'progress.json'), cancelFile: path.join(dir, 'cancel.json') },
      {
        model: scriptedBrowserModel([{ name: 'capture_profile' }]),
        runTask: async (options) => {
          await mkdir(options.filesDir, { recursive: true })
          return runBrowserTask({
            ...options,
            browser: {
              listTools: async () => [],
              callTool: async () => reply(source),
              close: async () => {
                closed = true
              },
            },
          })
        },
        extract: async () => {
          closedBeforeExtraction = closed
          throw new Error('Mock private model diagnostics')
        },
      },
    )
    assert({
      given: 'a model failure after successful profile capture',
      should: 'leave a safe editable draft and remove temporary task files',
      actual: [
        closedBeforeExtraction,
        result.name,
        result.url,
        !!result.warning,
        result.warning?.includes('diagnostics'),
        await readdir(dir),
        (await readFile(path.join(dir, 'progress.json'), 'utf8')).includes('Preparing'),
      ],
      expected: [true, 'Jane Doe', PROFILE, true, false, ['progress.json'], true],
    })
  })
})

test('a cancelled import never starts a browser task', async () => {
  await fixture(async (dir) => {
    let launched = false
    let message = ''
    const cancelFile = path.join(dir, 'cancel.json')
    await writeJson(cancelFile, { cancelled: true })
    try {
      await importLinkedIn(
        { url: PROFILE, cancelFile, progressFile: path.join(dir, 'progress.json') },
        {
          runTask: async () => {
            launched = true
            throw new Error('Unexpected browser')
          },
          extract: async () => {
            throw new Error('Unexpected extraction')
          },
        },
      )
    } catch (error) {
      message = (error as Error).message
    }
    assert({
      given: 'an import cancelled before it runs',
      should: 'stop before any browser or approval prompt',
      actual: [launched, message],
      expected: [false, 'Import cancelled.'],
    })
  })
})

test('Brave connection failures keep their reconnect instructions', async () => {
  await fixture(async (dir) => {
    for (const code of [-32010, -32000]) {
      let message = ''
      try {
        await importLinkedIn(
          { url: PROFILE, cancelFile: path.join(dir, 'cancel.json'), progressFile: path.join(dir, 'progress.json') },
          {
            model: scriptedBrowserModel([]),
            runTask: async () => {
              throw new McpError(
                code === -32010
                  ? 'Reconnect Brave in Settings → Browser automation.'
                  : 'Mock private worker diagnostics',
                code,
              )
            },
            extract: async () => {
              throw new Error('Unexpected extraction')
            },
          },
        )
      } catch (error) {
        message = (error as Error).message
      }
      assert({
        given: code === -32010 ? 'a disconnected Brave session' : 'a private worker failure',
        should: 'preserve actionable connection errors while hiding worker diagnostics',
        actual: [message.includes('Reconnect Brave'), message.includes('diagnostics')],
        expected: [code === -32010, false],
      })
    }
  })
})

test('cancellation during a browser handoff closes the task without extracting a draft', async () => {
  await fixture(async (dir) => {
    const input = {
      url: PROFILE,
      cancelFile: path.join(dir, 'cancel.json'),
      progressFile: path.join(dir, 'progress.json'),
    }
    let closed = false
    let extracted = false
    let message = ''
    try {
      await importLinkedIn(input, {
        model: scriptedBrowserModel([
          { name: 'wait_for_person', input: { message: 'Finish verification in the browser.' } },
        ]),
        runTask: async (options) => {
          await mkdir(options.filesDir, { recursive: true })
          return runBrowserTask({
            ...options,
            browser: {
              listTools: async () => [],
              close: async () => {
                closed = true
              },
              callTool: async () => {
                await writeJson(input.cancelFile, { cancelled: true })
                return { ...reply('Credential entry hidden'), structuredContent: { kind: 'authentication_required' } }
              },
            },
          })
        },
        extract: async () => {
          extracted = true
          throw new Error('Unexpected extraction')
        },
      })
    } catch (error) {
      message = (error as Error).message
    }
    assert({
      given: 'cancellation while verification is waiting',
      should: 'interrupt the shared browser task and preserve the cancellation reason',
      actual: [message, closed, extracted],
      expected: ['Import cancelled.', true, false],
    })
  })
})
