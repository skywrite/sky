import { assert, test } from '#test'
import {
  canSendReport,
  describeReportTarget,
  reportDeliveryMode,
  reportDeliveryStatus,
  reportTargetLink,
  slackReportTarget,
} from './workstreamsDeliveryModel.ts'

test({ name: 'report delivery UI - legacy email send grants remain review-only' }, () => {
  assert({
    given: 'email and Slack settings with stored send permission',
    should: 'force email to review while preserving Slack delivery choices',
    actual: [
      reportDeliveryMode('email', 'send'),
      reportDeliveryMode('email', 'review'),
      reportDeliveryMode('slack', 'send'),
    ],
    expected: ['review', 'review', 'send'],
  })
})

test({ name: 'report delivery UI - only Slack reviews can expose a send action' }, () => {
  const email = { medium: 'email' as const, account: 'jane@example.com', to: ['review@example.com'] }
  const slack = { medium: 'slack' as const, workspace: 'https://atlas.slack.com/', channelId: 'C12345678' }
  assert({
    given: 'email reviews, changed media, and Slack review or recovery states',
    should: 'hide email sending even when an older target disagrees with the current reporting medium',
    actual: [
      canSendReport({ status: 'review', target: email }, 'email'),
      canSendReport({ status: 'failed', target: email }, 'slack'),
      canSendReport({ status: 'review', target: slack }, 'email'),
      canSendReport({ status: 'review' }, 'email'),
      canSendReport({ status: 'review' }),
      canSendReport({ status: 'review', target: slack }, 'slack'),
      canSendReport({ status: 'failed', target: slack }, 'slack'),
      canSendReport({ status: 'unknown', target: slack }, 'slack'),
    ],
    expected: [false, false, false, false, false, true, true, false],
  })
})

test({ name: 'report delivery UI - a Slack conversation link preserves its exact thread destination' }, () => {
  const target = slackReportTarget('https://atlas.slack.com/archives/C12345678/p1800000000123456')
  assert({
    given: 'a Slack message link',
    should: 'retain the workspace, channel, and exact thread rather than widen delivery to the whole channel',
    actual: target,
    expected: {
      medium: 'slack',
      workspace: 'https://atlas.slack.com/',
      channelId: 'C12345678',
      threadTs: '1800000000.123456',
    },
  })
  assert({
    given: 'the saved target',
    should: 'reopen the same conversation in the editor',
    actual: reportTargetLink(target),
    expected: 'https://atlas.slack.com/archives/C12345678/p1800000000123456',
  })
  assert({
    given: 'a reply link carrying its parent thread',
    should: 'use the parent conversation explicitly supplied in the URL',
    actual: slackReportTarget(
      'https://atlas.slack.com/archives/C12345678/p1800000000123456?thread_ts=1799999999.654321',
    ),
    expected: {
      medium: 'slack',
      workspace: 'https://atlas.slack.com/',
      channelId: 'C12345678',
      threadTs: '1799999999.654321',
    },
  })
})

test({ name: 'report delivery UI - destination parsing rejects lookalike and credential-bearing URLs' }, () => {
  const rejected = [
    'https://atlas.slack.com.evil.example/archives/C12345678',
    'https://name:password@atlas.slack.com/archives/C12345678',
    'http://atlas.slack.com/archives/C12345678',
    'https://atlas.slack.com/settings',
  ].map((link) => {
    try {
      slackReportTarget(link)
      return false
    } catch {
      return true
    }
  })
  assert({
    given: 'links that are not exact Slack destinations',
    should: 'refuse to turn them into delivery targets',
    actual: rejected,
    expected: [true, true, true, true],
  })
})

test({ name: 'report delivery UI - sending, uncertainty, and a provider receipt remain distinct' }, () => {
  assert({
    given: 'a review, pending send, uncertain send, and confirmed delivery',
    should: 'show observed status without treating drafts or an in-flight request as sent',
    actual: [
      reportDeliveryStatus({ status: 'review' }),
      reportDeliveryStatus({ status: 'sending' }),
      reportDeliveryStatus({ status: 'unknown' }),
      reportDeliveryStatus({ status: 'superseded' }),
      reportDeliveryStatus({
        status: 'sent',
        receipt: { id: 'message', medium: 'email', url: 'https://example.com/sent/message' },
      }),
    ],
    expected: [
      'Ready for your review',
      'Sending · awaiting confirmation',
      'Delivery uncertain · checking is required',
      'Replaced by newer report',
      'Sent · provider receipt recorded',
    ],
  })
  assert({
    given: 'an exact email audience and account',
    should: 'show both parts of the authorization',
    actual: describeReportTarget({ medium: 'email', account: 'jane@example.com', to: ['board@example.com'] }),
    expected: 'board@example.com · from jane@example.com',
  })
})
