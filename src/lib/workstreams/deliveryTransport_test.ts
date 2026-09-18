import process from 'node:process'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { ReportSendRejectedError, ReportSendUnknownError, type ReportDeliveryRecord } from './delivery.ts'
import { createReportTransport } from './deliveryTransport.ts'

function report(body = 'The Atlas brief is ready.'): ReportDeliveryRecord {
  return {
    id: 'report1',
    workstreamId: 'atlas',
    reportingId: 'team',
    artifactId: 'artifact1',
    activityId: 'activity1',
    status: 'sending',
    created: '2025-03-15 12:00',
    updated: '2025-03-15 12:00',
    title: 'Atlas update',
    body,
    artifactVersion: 'artifact',
    policyVersion: 'policy',
    revision: 'revision',
    sourceVersions: {},
    blockers: [],
    target: { medium: 'slack', workspace: 'https://example.slack.com', channelId: 'C01234567', threadTs: '12345.678' },
    attachments: [{ name: 'Brief', url: 'https://example.com/brief' }],
  }
}
async function withoutSafeMode(run: () => Promise<void>) {
  const original = process.env.AGENT_SLACK_SAFE_MODE
  delete process.env.AGENT_SLACK_SAFE_MODE
  try {
    await run()
  } finally {
    if (original === undefined) delete process.env.AGENT_SLACK_SAFE_MODE
    else process.env.AGENT_SLACK_SAFE_MODE = original
  }
}

test('Gmail report sending is rejected before authority, account access, or a provider request', async () => {
  let accountAccess = 0
  let authorized = 0
  const transport = createReportTransport({
    secrets: new Proxy(new TestSecretsProvider(), {
      get() {
        accountAccess++
        throw new Error('Gmail sending must stop before account access.')
      },
    }),
  })
  let error: unknown
  try {
    await transport.send(
      { ...report(), target: { medium: 'email', account: 'owner@example.com', to: ['jane@example.com'] } },
      async () => {
        authorized++
      },
    )
  } catch (problem) {
    error = problem
  }
  assert({
    given: 'an email report with an authorization callback',
    should: 'enforce draft-only Gmail before touching accounts or authorizing an external write',
    actual: [error instanceof ReportSendRejectedError, (error as Error)?.message, accountAccess, authorized],
    expected: [true, 'Gmail is draft-only. Create a draft and send it yourself from Gmail.', 0, 0],
  })
})

test('Slack report transport uses the exact approved workspace, conversation and thread', async () =>
  withoutSafeMode(async () => {
    let args: string[] = []
    let checked = false
    const transport = createReportTransport({
      secrets: new TestSecretsProvider(),
      runSlack: async (input) => {
        if (!checked) throw new Error('Authority was not checked before the write.')
        args = input
        return {
          success: true,
          code: 0,
          stderr: '',
          stdout: JSON.stringify({ ok: true, channel_id: 'C01234567', ts: '12346.789' }),
        }
      },
    })
    const receipt = await transport.send(report(), async () => {
      checked = true
    })
    assert({
      given: 'a standing grant for a specific Slack thread',
      should: 'check authority then use that exact destination and retain the observed receipt',
      actual: [args.slice(0, -1), args.at(-1)?.includes('https://example.com/brief'), receipt.id, receipt.url],
      expected: [
        [
          'message',
          'send',
          '--workspace',
          'https://example.slack.com',
          '--no-unfurl',
          '--thread-ts',
          '12345.678',
          '--',
          'C01234567',
        ],
        true,
        'C01234567:12346.789',
        'https://example.slack.com/archives/C01234567/p12346789',
      ],
    })
  }))

test('Slack incomplete or wrong-conversation receipts remain uncertain and never retry', async () =>
  withoutSafeMode(async () => {
    const observed: [boolean, number][] = []
    for (const stdout of [
      '{}',
      'invalid JSON',
      JSON.stringify({ ok: true, channel_id: 'C99999999', ts: '12346.789' }),
    ]) {
      let calls = 0
      const transport = createReportTransport({
        secrets: new TestSecretsProvider(),
        runSlack: async () => {
          calls++
          return { success: true, code: 0, stderr: '', stdout }
        },
      })
      let unknown = false
      try {
        await transport.send(report(), async () => {})
      } catch (error) {
        unknown = error instanceof ReportSendUnknownError
      }
      observed.push([unknown, calls])
    }
    assert({
      given: 'no complete provider receipt for the authorized conversation',
      should: 'retain uncertainty after exactly one transport invocation',
      actual: observed,
      expected: [
        [true, 1],
        [true, 1],
        [true, 1],
      ],
    })
  }))

test('Slack refuses safe-mode and oversized report sends before any transport write', async () => {
  const original = process.env.AGENT_SLACK_SAFE_MODE
  let calls = 0
  const observed: boolean[] = []
  const transport = createReportTransport({
    secrets: new TestSecretsProvider(),
    runSlack: async () => {
      calls++
      throw new Error('Must not run')
    },
  })
  try {
    process.env.AGENT_SLACK_SAFE_MODE = 'true'
    try {
      await transport.send(report(), async () => {})
    } catch (error) {
      observed.push(error instanceof ReportSendRejectedError)
    }
    delete process.env.AGENT_SLACK_SAFE_MODE
    try {
      await transport.send(report('x'.repeat(40_000)), async () => {})
    } catch (error) {
      observed.push(error instanceof ReportSendRejectedError)
    }
    assert({
      given: 'safe mode or report text plus artifacts exceeding Slack’s limit',
      should: 'reject before an external write instead of opening a composer or truncating content',
      actual: [observed, calls],
      expected: [[true, true], 0],
    })
  } finally {
    if (original === undefined) delete process.env.AGENT_SLACK_SAFE_MODE
    else process.env.AGENT_SLACK_SAFE_MODE = original
  }
})
