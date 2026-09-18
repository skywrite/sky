import process from 'node:process'
import { WebClient } from '@slack/web-api'
import { resolveGmailClient } from '#commands/all/google/email/lib/resolveGmailClient.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import {
  ReportSendRejectedError,
  ReportSendUnknownError,
  type ReportDeliveryRecord,
  type ReportDeliveryReceipt,
  type ReportTransport,
} from './delivery.ts'

/** Slack delivery and read-only reconciliation. Gmail messages are sent manually from saved drafts. */
export function createReportTransport(options: {
  secrets: SecretsProvider
  slackToken?: string
  runSlack?: typeof runAgentSlack
}): ReportTransport {
  const send = async (
    delivery: ReportDeliveryRecord,
    authorize: () => Promise<void>,
  ): Promise<ReportDeliveryReceipt> => {
    const target = delivery.target
    if (!target) throw new ReportSendRejectedError('This report has no exact delivery destination.')
    if (target.medium === 'email')
      throw new ReportSendRejectedError('Gmail is draft-only. Create a draft and send it yourself from Gmail.')
    const attachmentLinks = delivery.attachments
      .map((attachment) => `[${attachment.name}](${attachment.url})`)
      .join('\n')
    const body = `${delivery.body.trim()}${attachmentLinks ? `\n\n${attachmentLinks}` : ''}`
    if (body.length > 40_000)
      throw new ReportSendRejectedError(
        'The report exceeds Slack’s 40,000-character limit. Shorten the report before sending.',
      )
    if (options.slackToken) {
      if (['1', 'true', 'yes', 'on'].includes(process.env.AGENT_SLACK_SAFE_MODE?.toLowerCase() ?? ''))
        throw new ReportSendRejectedError(
          'Slack safe mode requires human review; automatic report sending is disabled.',
        )
      const client = new WebClient(options.slackToken, {
        retryConfig: { retries: 0 },
        rejectRateLimitedCalls: true,
        timeout: 45_000,
      })
      let began = false
      try {
        const account = await client.auth.test()
        if (!account.url || new URL(account.url).origin !== new URL(target.workspace).origin)
          throw new ReportSendRejectedError('The Slack token belongs to another workspace.')
        await authorize()
        began = true
        const response = (await client.apiCall('chat.postMessage', {
          channel: target.channelId,
          text: body,
          thread_ts: target.threadTs,
          client_msg_id: delivery.id,
          unfurl_links: false,
          unfurl_media: false,
        })) as { ok?: boolean; ts?: string; channel?: string }
        if (response.ok !== true || typeof response.ts !== 'string' || response.channel !== target.channelId)
          throw new ReportSendUnknownError('Slack did not return a complete receipt for the intended conversation.')
        return {
          medium: 'slack',
          id: `${target.channelId}:${response.ts}`,
          url: `${new URL(target.workspace).origin}/archives/${target.channelId}/p${response.ts.replace('.', '')}`,
        }
      } catch (error) {
        if (error instanceof ReportSendRejectedError || error instanceof ReportSendUnknownError) throw error
        const known = (error as { data?: { error?: string }; code?: string }).data?.error
        if (
          !began ||
          (known &&
            [
              'not_authed',
              'invalid_auth',
              'token_revoked',
              'missing_scope',
              'channel_not_found',
              'not_in_channel',
              'is_archived',
              'msg_too_long',
              'no_text',
              'restricted_action',
              'rate_limited',
            ].includes(known))
        )
          throw new ReportSendRejectedError(error instanceof Error ? error.message : 'Slack refused this report.')
        throw new ReportSendUnknownError(
          error instanceof Error ? error.message : 'Slack delivery could not be confirmed.',
        )
      }
    }
    // Existing browser-auth Slack integration. Preserve its safe mode; a redirected draft is never a send.
    if (['1', 'true', 'yes', 'on'].includes(process.env.AGENT_SLACK_SAFE_MODE?.toLowerCase() ?? ''))
      throw new ReportSendRejectedError('Slack safe mode requires human review; automatic report sending is disabled.')
    await authorize()
    const args = ['message', 'send', '--workspace', target.workspace, '--no-unfurl']
    if (target.threadTs) args.push('--thread-ts', target.threadTs)
    args.push('--', target.channelId, body)
    let output: Awaited<ReturnType<typeof runAgentSlack>>
    try {
      output = await (options.runSlack ?? runAgentSlack)(args)
    } catch (error) {
      throw new ReportSendUnknownError(
        error instanceof Error ? error.message : 'Slack delivery could not be confirmed.',
      )
    }
    if (!output.success)
      throw new ReportSendUnknownError('Slack did not confirm delivery. Check the conversation before trying again.')
    let receipt: Record<string, unknown>
    try {
      receipt = JSON.parse(output.stdout) as Record<string, unknown>
    } catch {
      throw new ReportSendUnknownError('Slack returned an unreadable delivery receipt.')
    }
    if (
      (receipt.safe_mode || receipt.draft || receipt.redirected) &&
      !(receipt.channel_id === target.channelId && typeof receipt.ts === 'string')
    )
      throw new ReportSendRejectedError('Slack safe mode prepared a draft instead of sending. Review it in Slack.')
    if (receipt.ok !== true || receipt.channel_id !== target.channelId || typeof receipt.ts !== 'string')
      throw new ReportSendUnknownError('Slack did not confirm a sent message in the authorized conversation.')
    return {
      medium: 'slack',
      id: `${target.channelId}:${receipt.ts}`,
      url: `${new URL(target.workspace).origin}/archives/${target.channelId}/p${receipt.ts.replace('.', '')}`,
    }
  }
  const reconcile = async (delivery: ReportDeliveryRecord): Promise<ReportDeliveryReceipt | null> => {
    const target = delivery.target
    if (!target) return null
    if (target.medium === 'email') {
      const client = await resolveGmailClient({
        secrets: options.secrets,
        requested: target.account,
        interactive: false,
      })
      if (client.email.toLowerCase() !== target.account.toLowerCase())
        throw new ReportSendRejectedError('The selected Gmail account changed.')
      const query = encodeURIComponent(`in:sent rfc822msgid:sky-report-${delivery.id}@sky.local`)
      const found = await client.getJson<{ messages?: { id: string; threadId: string }[] }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=2`,
      )
      if (found.messages?.length !== 1) return null
      const message = found.messages[0]
      return {
        medium: 'email',
        id: message.id,
        url: `https://mail.google.com/mail/u/${encodeURIComponent(client.email)}/#sent/${message.threadId}`,
      }
    }
    if (!options.slackToken) return null
    const client = new WebClient(options.slackToken, {
      retryConfig: { retries: 0 },
      rejectRateLimitedCalls: true,
      timeout: 30_000,
    })
    const account = await client.auth.test()
    if (!account.url || new URL(account.url).origin !== new URL(target.workspace).origin) return null
    const response = (await client.apiCall(target.threadTs ? 'conversations.replies' : 'conversations.history', {
      channel: target.channelId,
      ts: target.threadTs,
      limit: 100,
    })) as { messages?: unknown }
    const messages = Array.isArray(response.messages)
      ? (response.messages as { client_msg_id?: string; ts?: string }[])
      : []
    const found = messages.filter((message) => message.client_msg_id === delivery.id && message.ts)
    if (found.length !== 1) return null
    return {
      medium: 'slack',
      id: `${target.channelId}:${found[0].ts}`,
      url: `${new URL(target.workspace).origin}/archives/${target.channelId}/p${found[0].ts!.replace('.', '')}`,
    }
  }
  return { send, reconcile }
}
