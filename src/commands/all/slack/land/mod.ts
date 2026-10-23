import * as path from 'node:path'
import { slackAuthStatus, slackProfileName } from '#commands/all/slack/lib/authStatus.ts'
import { formatSlackTimestamp } from '#commands/all/slack/lib/mod.ts'
import { type DmMembership, fetchDmMembership, resolveUserNames } from '#commands/all/slack/lib/resolveNames.ts'
import { saveSlackCaptureUpdate } from '#commands/all/slack/lib/saveCapture.ts'
import { summarizeSlackMessage } from '#commands/all/slack/lib/summarize.ts'
import {
  clearSavedVoiceTranscripts,
  prepareSlackVoiceTranscripts,
} from '#commands/all/slack/lib/transcribeVoiceMemo.ts'
import { updateSlackCapture } from '#commands/all/slack/lib/updateCapture.ts'
import { isHousekeeping } from '#commands/all/slack/pull/lib/entries.ts'
import { createNameResolver } from '#commands/all/slack/pull/lib/names.ts'
import { toTs } from '#commands/all/slack/pull/lib/ts.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_BASE, DIR_STATE, DIR_STATE_SLACK_DMS, FILE_STATE_SLACK_LAND, SLACK_WORKSPACE } from '#config'
import { withProcessLock } from '#lib/jobs/files.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { atomicWrite } from '#lib/outbox/files.ts'
import { loadSkyConfig, slackForYou } from '#shared/config/loader.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import { computePreviousRef, notebookTimeAt, resolveTimeRef, toTimeRef } from '#shared/nbfs/mod.ts'
import { Instant, instantNow } from '#universal/dates/nbdt/mod.ts'
import { toCaptureMessages } from './lib/convert.ts'
import { type DmRecord, readDmRecord, recipientOf, syncDmRecord, writeDmRecord } from './lib/dms.ts'
import { listActivity, listConversation, searchOwnMessages } from './lib/feed.ts'
import {
  type ConversationKind,
  LAND_DEFAULTS,
  landActivity,
  type LandHost,
  type LandResult,
  type ThreadOutcome,
} from './lib/land.ts'
import { messageLink } from './lib/links.ts'
import { readLandState, writeLandState } from './lib/state.ts'

const params = {
  backfillDays: Flag.number('Days back the first landing looks', { default: LAND_DEFAULTS.backfillDays }),
  dryRun: Flag.bool('Say what would land, and land nothing', { default: false }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:land': { params: Params; result: LandResult }
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export default class SlackLandTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:land',
    description:
      'Land what Slack addressed to you in the day: direct messages, mentions, replies in your threads, your own messages.',
    descriptionLong: [
      'Reads your Slack activity since the last pass and lands each conversation',
      'it names in the day directory, as the documents a Slack capture writes:',
      'a thread you were mentioned in or replied to is captured whole and',
      'followed for new replies; a direct or group conversation gets one',
      'document per day, appended to as it goes on. Your own messages count',
      'too, so Sky knows what you already answered. Nothing is written into',
      'the day file itself, and nothing is marked read in Slack.',
      '',
      'The first pass looks --backfill-days back (default 7). Sky keeps its',
      'own place in your activity under state/slack/land.yaml, and one record',
      'per direct conversation under state/slack/dms/. Threads use the follow',
      'ledger, so a thread captured by hand is brought up to date, never',
      'copied. What lands follows For you under Settings › Connections › Slack:',
      'direct messages, mentions and thread replies, your own messages.',
      '',
      '--dry-run lists what would land and lands nothing. The service runs a',
      'pass every five minutes; only one runs at a time.',
    ],
    usage: ['sky slack:land', 'sky slack:land --dry-run', 'sky slack:land --backfill-days 1'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<LandResult>> {
    const { output, systemNow } = context
    const workspace = SLACK_WORKSPACE
    if (!workspace) {
      return CommandResult.fail(
        'No Slack workspace is configured: set slack.workspace in ~/.sky/config.jsonc, then run sky slack:auth.',
      )
    }
    if (args.backfillDays < 1) return CommandResult.fail('--backfill-days must be at least 1.')
    const rules = slackForYou(loadSkyConfig())
    const empty: LandResult = {
      dryRun: args.dryRun,
      plan: { threads: [], conversations: [] },
      threads: [],
      conversations: [],
      docs: 0,
      known: 0,
      errors: [],
    }
    if (!rules.dms && !rules.mentions && !rules.own) {
      output.log(
        'Everything under For you is off; nothing lands. Switch something on under Settings › Connections › Slack.',
      )
      return CommandResult.success(empty)
    }
    const auth = await slackAuthStatus(workspace)
    if (!auth.ok)
      return CommandResult.fail(`Slack is not connected (${auth.error.trim() || auth.reason}). Run sky slack:auth.`)
    const selfId = auth.userId
    if (rules.own && !selfId) output.log('Slack did not say who you are; your own messages are skipped this pass.')

    const timezone = systemNow.timezone
    const nowSeconds = Math.floor(Instant.from(instantNow()).epochMilliseconds / 1000)
    const resolver = createNameResolver(workspace)
    let booted: Promise<DmMembership> | undefined
    const membership = () => (booted ??= fetchDmMembership(workspace))
    let selfName: string | undefined
    const self = async () =>
      (selfName ??= (selfId ? await slackProfileName(selfId, workspace) : undefined) ?? auth.user ?? undefined)
    const memberNames = async (channelId: string): Promise<string[]> => {
      const boot = await membership()
      const ids = (boot.membersByChannel.get(channelId) ?? []).filter((id) => id !== selfId)
      if (ids.length === 0) return []
      const names = await resolveUserNames(ids, workspace)
      return ids.map((id) => names.get(id) ?? id)
    }

    const host: LandHost = {
      workspace,
      nowSeconds,
      stamp: formatSlackTimestamp(toTs(nowSeconds), timezone),
      rules: { ...rules, own: rules.own && Boolean(selfId) },
      log: (line) => output.log(line),
      signal: context.signal,
      readState: () => readLandState(FILE_STATE_SLACK_LAND),
      writeState: (state) => writeLandState(FILE_STATE_SLACK_LAND, state),
      feed: (since, types) => listActivity(workspace, since, types),
      own: async (since) => {
        if (!selfId) return []
        // Slack's after: is a day; ask from the day before the cursor and let the pass keep what is newer
        const day = formatSlackTimestamp(toTs(Number(since.split('.')[0]) - 86400), timezone).slice(0, 10)
        return searchOwnMessages(workspace, selfId, day)
      },
      kindOf: async (channelId): Promise<ConversationKind> => {
        const kind = (await membership()).conversations?.get(channelId)?.kind
        if (kind === 'dm' || kind === 'group' || kind === 'channel') return kind
        return channelId.startsWith('D') ? 'dm' : 'channel'
      },
      captureThread: async (link): Promise<ThreadOutcome> => {
        const result = await tasks.run('slack:follow:message', { link, landing: true, noEditor: true })
        if (result.ok) return { status: 'landed', docs: result.data?.slackFiles.length ?? 0 }
        const message = result.message ?? ''
        if (/Duplicate follow|Already captured/.test(message)) return { status: 'known' }
        if (/not found|channel_not_found|not_in_channel|thread_not_found/i.test(message)) return { status: 'gone' }
        return { status: 'failed', message: message || 'the capture failed' }
      },
      landConversation: async (channelId, kind, since) => {
        try {
          const members = await memberNames(channelId)
          const record: DmRecord = (await readDmRecord(DIR_STATE_SLACK_DMS, channelId)) ?? {
            id: channelId,
            kind,
            label: members.join(', ') || (await membership()).conversations?.get(channelId)?.name || channelId,
            docs: [],
          }
          const raw = (await listConversation(workspace, channelId, record.cursor ?? since)).filter(
            (message) => !isHousekeeping(message),
          )
          if (raw.length === 0) return { status: 'landed', messages: 0, docs: 0 }
          const names = await resolver.resolve(raw)
          const transcriptRuns = new Set<string>()
          const messages = await prepareSlackVoiceTranscripts(
            await toCaptureMessages(raw, { workspace, timezone, names }),
            { output, signal: context.signal, runs: transcriptRuns },
          )
          let docs = 0
          const synced = await syncDmRecord(record, messages, {
            read: async (ref) =>
              MessageDocument.fromMarkdown(await readTextFile(path.join(DIR_BASE, resolveTimeRef(ref)))),
            notebookTime: notebookTimeAt,
            update: async (ref, doc, batch, day) => {
              const updated = await updateSlackCapture({
                doc,
                messages: batch,
                day,
                output,
                signal: context.signal,
                transcriptRuns,
              })
              if (updated.toMarkdown() === doc.toMarkdown()) return
              await saveSlackCaptureUpdate(path.join(DIR_BASE, resolveTimeRef(ref)), doc, updated)
              docs++
            },
            create: async ({ messages: batch, when, previous, inherit }) => {
              const from = batch[0].userName ?? batch[0].userId ?? '-'
              const to = recipientOf(record, members, from, await self())
              const summary = (await summarizeSlackMessage(batch[0], batch.slice(1))) ?? record.label
              const inheritedTags = inherit?.yaml['tags']
              const inheritedRel = inherit?.yaml['rel']
              const result = await tasks.run('slack:new', {
                from,
                to,
                summary,
                when,
                slackMessages: JSON.stringify(batch),
                link: messageLink(workspace, channelId, batch[0].ts),
                previous: previous ? computePreviousRef(resolveTimeRef(previous), when.plainDate) : undefined,
                noEditor: true,
                noDayLog: true,
                ...(typeof inheritedTags === 'string' ? { tags: inheritedTags } : {}),
                ...(typeof inheritedRel === 'string' ? { rel: inheritedRel } : {}),
                ...(Array.isArray(inheritedRel) ? { noAutoRel: true } : {}),
              })
              if (!result.ok || !result.data?.filePath) {
                throw new Error(`Failed to land the conversation: ${result.message ?? 'no file path'}`)
              }
              const timePath = `time/${new DayDirFileWriter(when.plainDate).dayDir}/${result.data.filePath}`
              if (Array.isArray(inheritedRel)) {
                const fullPath = path.join(DIR_BASE, timePath)
                const doc = MessageDocument.fromMarkdown(await readTextFile(fullPath))
                await atomicWrite(
                  fullPath,
                  new MessageDocument({ ...doc.yaml, rel: inheritedRel }, doc.markdown).toMarkdown(),
                )
              }
              docs++
              return toTimeRef(timePath)
            },
          })
          await writeDmRecord(DIR_STATE_SLACK_DMS, synced.record)
          await clearSavedVoiceTranscripts(transcriptRuns, output)
          return { status: 'landed', messages: synced.newMessages, docs }
        } catch (error) {
          return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
        }
      },
    }

    const result = await withProcessLock(path.join(DIR_STATE, 'slack', 'land-lock'), () =>
      landActivity(host, { backfillDays: args.backfillDays, dryRun: args.dryRun }),
    )
    if (!result) return CommandResult.fail('Another Slack landing is running. Try again in a moment.')

    if (result.dryRun) {
      const { threads, conversations } = result.plan
      output.log(`${plural(threads.length, 'thread')} and ${plural(conversations.length, 'conversation')} would land:`)
      for (const conversation of conversations) output.log(`  ${conversation.why}: ${conversation.id}`)
      for (const thread of threads) output.log(`  ${thread.why}: ${thread.link}`)
      return CommandResult.success(result)
    }
    const threads = result.threads.filter((thread) => thread.outcome.status === 'landed').length
    const conversations = result.conversations.filter(
      (conversation) => conversation.outcome.status === 'landed' && conversation.outcome.messages > 0,
    ).length
    output.log('')
    output.log(
      `${plural(result.docs, 'document')} landed from ${plural(threads, 'thread')} and ${plural(conversations, 'conversation')}; ${result.known} already in the notebook; ${result.errors.length} failed.`,
    )
    for (const error of result.errors) output.log(`  ${error}`)
    return CommandResult.success(result)
  }
}
