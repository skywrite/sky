import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { runCommand } from '#lib/sys/mod.ts'
import { assert, test } from '#test'

test('Slack CLI export carries remote URLs and pending source links into root and reply files', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-file-export-test-'))
  try {
    const result = await runCommand(
      'bun',
      [
        '--eval',
        `
      import { strict as check } from 'node:assert'
      import { mock } from 'bun:test'
      const root = { channel_id: 'C0ATLAS', ts: '1770000000.000001', author: { user_id: 'U0AUTHOR' }, content: '', files: [
        { name: 'Atlas slides', mode: 'external', path: '/tmp/mock-slack/F0DECK.download-error.txt', error: 'Downloaded HTML instead of file' },
      ] }
      const reply = { ...root, ts: '1770090000.000001', files: [
        { name: 'report.pdf', path: '/tmp/mock-slack/F0REPORT.download-error.txt', error: 'Unauthorized' },
        { name: 'Atlas slides', mode: 'external', path: '/tmp/mock-slack-reply/F0DECK.download-error.txt', error: 'Reply download failed' },
      ] }
      const lookupIds = []
      mock.module('#commands/all/slack/lib/agentSlack.ts', () => ({ runAgentSlack: async args => ({
        code: 0, stderr: '', stdout: JSON.stringify(args[1] === 'get' ? { message: root, thread: { ts: root.ts, length: 2 } } : { messages: [root, reply] }),
      }) }))
      mock.module('#commands/all/slack/lib/slack-api.ts', () => ({ slackApiCall: async (_workspace, method, params) => {
        if (method === 'chat.getPermalink') return { permalink: 'https://atlas.slack.com/archives/C0ATLAS/p1770000000000001' }
        check.equal(method, 'files.info')
        lookupIds.push(params.file)
        if (params.file === 'F0REPORT') return undefined
        return { file: { id: params.file, is_external: true, external_url: 'https://example.com/slides/atlas' } }
      } }))
      mock.module('#commands/all/slack/lib/resolveNames.ts', () => ({
        resolveUserNames: async () => new Map([['U0AUTHOR', 'Jane Doe']]),
        resolveChannelInfo: async () => ({ name: 'atlas', detectedType: 'channel' }),
        resolveChannelNames: async () => new Map(),
        resolveUsergroupNames: async () => new Map(),
        resolveUserName: async () => 'Jane Doe',
      }))
      const { default: Task } = await import('#commands/all/slack/cli/export/mod.ts')
      const result = await new Task().run({
        args: { link: 'https://atlas.slack.com/archives/C0ATLAS/p1770000000000001' },
        context: { output: { log() {} }, systemNow: { timezone: 'UTC' } },
      })
      check.equal(result.ok, true, result.message)
      check.deepEqual(lookupIds, ['F0DECK', 'F0REPORT'])
      check.equal(result.data.message.files[0].id, 'F0DECK')
      check.equal(result.data.message.files[0].externalUrl, 'https://example.com/slides/atlas')
      check.equal(result.data.message.files[0].path, root.files[0].path)
      const files = result.data.thread.replies[0].files
      check.equal(files[0].id, 'F0REPORT')
      check.equal(files[0].externalUrl, undefined)
      check.equal(files[0].sourceUrl, 'https://atlas.slack.com/archives/C0ATLAS/p1770090000000001')
      check.equal(files[1].externalUrl, 'https://example.com/slides/atlas')
      check.equal(files[1].path, reply.files[1].path)
      check.equal(files[1].error, 'Reply download failed')
    `,
      ],
      { env: { SKY_DIR: path.join(temp, 'notebook'), SKY_DATA_DIR: path.join(temp, 'user-data') } },
    )
    assert({
      given: 'compact root and thread payloads containing failed remote and hosted downloads',
      should: 'restore URLs once per provider ID and retain each message’s own file paths and source links',
      actual: result.success || result.stderr,
      expected: true,
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
