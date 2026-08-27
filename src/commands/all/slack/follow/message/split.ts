import * as path from 'node:path'
import parseMessageLink from '#commands/all/slack/lib/parseMessageLink.ts'
import { summarizeSlackMessage } from '#commands/all/slack/lib/summarize.ts'
import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_STATE_FOLLOW_SLACK_ACTIVE, DIR_STATE_FOLLOW_SLACK_ARCHIVE } from '#config'
import slugify from '#lib/string/slugify.ts'
import { outputFile, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import Follow from '#shared/models/Follow/mod.ts'
import SlackFollowRegistry from '#shared/models/Follow/SlackFollowRegistry.ts'
import { convertToNotebookTimezone, fetchNowSync } from '#shared/nbfs/mod.ts'
import { anchorTs } from './merge.ts'

const params = {
  link: Arg.string('Link to the thread to split out of its merged conversation'),
}

type Params = InferParams<typeof params>
type Result = {
  /** The new follow YAML holding the extracted thread */
  file: string
  /** The follow the thread was extracted from */
  from: string
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:follow:message:split': {
      params: Params
      result: Result
    }
  }
}

export default class SlackFollowMessageSplitTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:follow:message:split',
    description: 'Split a thread out of a merged conversation into its own follow.',
    descriptionLong: [
      'The inverse of merge, for when merged threads grow into separate',
      'topics. Forward-only: docs already written stay with the original',
      'conversation exactly as they are — the extracted thread starts a fresh',
      'follow that captures its replies from now on.',
    ],
    usage: ['sky slack:follow:message:split "https://ws.slack.com/archives/C01/p456…"'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context

    // Resolve the link to channel + root ts, asking Slack only when the link
    // alone doesn't name its root (a bare reply p-link)
    let parsed = parseMessageLink(args.link)
    let identity = parsed ? { channel: parsed.channelId, rootTs: parsed.rootTs } : undefined
    const locate = async () =>
      identity
        ? ((await find(DIR_STATE_FOLLOW_SLACK_ACTIVE, identity)) ??
          (await find(DIR_STATE_FOLLOW_SLACK_ARCHIVE, identity)))
        : undefined

    let located = await locate()
    if (!located) {
      const exportResult = await tasks.run('slack:cli:export', { link: args.link })
      if (!exportResult.ok || !exportResult.data) {
        return CommandResult.fail(`Failed to resolve ${args.link}: ${exportResult.message}`)
      }
      const data = exportResult.data
      identity = { channel: data.channelId, rootTs: data.threadTs ?? data.messageTs }
      located = await locate()
    }
    if (!located) {
      return CommandResult.fail('No follow holds this thread — nothing to split.')
    }

    const { entry } = located
    const follow = Follow.fromYaml(await readTextFile(entry.path))
    const anchors = [follow.ref, ...follow.merged]
    if (follow.merged.length === 0) {
      return CommandResult.fail(`${entry.fileName} watches a single thread — nothing to split.`)
    }

    const idx = anchors.findIndex((a) => a.channel === identity!.channel && anchorTs(a) === identity!.rootTs)
    if (idx === -1) {
      return CommandResult.fail(
        `${entry.fileName} owns this thread but no anchor matches it — split by an anchor link.`,
      )
    }
    const extracted = anchors[idx]
    const remaining = anchors.filter((_, i) => i !== idx)

    // The original keeps its docs and every other anchor; earliest remaining
    // anchor becomes (or stays) its identity
    remaining.sort((a, b) => (anchorTs(a) < anchorTs(b) ? -1 : 1))
    const kept = follow.withRef(remaining[0]).withMerged(remaining.slice(1))
    await writeTextFile(entry.path, kept.toYaml())

    // The extracted thread starts fresh: its own summary, no docs yet, and
    // lastChecked = now so only future replies are captured — the past
    // stays with the original conversation
    const exportResult = await tasks.run('slack:cli:export', { link: extracted.link })
    if (!exportResult.ok || !exportResult.data) {
      return CommandResult.fail(`Split recorded, but exporting the extracted thread failed: ${exportResult.message}`)
    }
    const data = exportResult.data
    const summary = (await summarizeSlackMessage(data.message, data.thread?.replies)) ?? 'Split conversation'
    const when = data.message.timeLabel
      ? await convertToNotebookTimezone(data.message.timeLabel)
      : fetchNowSync().plainDateTime
    const lastReplyLabel = data.thread?.replies.at(-1)?.timeLabel
    const lastActivity = lastReplyLabel ? await convertToNotebookTimezone(lastReplyLabel) : when
    const now = fetchNowSync().plainDateTime

    const split = Follow.create({
      source: 'Slack',
      ref: extracted,
      summary,
      followSince: now,
      lastChecked: now,
      lastActivity,
      messages: [],
      status: 'active',
    })
    const channelSlug = slugify(data.channelName || data.channelId, { preserveCase: true })
    const summarySlug = slugify(summary, { preserveCase: true, suggestedLength: 40 })
    const splitPath = path.join(
      DIR_STATE_FOLLOW_SLACK_ACTIVE,
      `${when.plainDate.toString()}_slack_${channelSlug}_${summarySlug}.yaml`,
    )
    await outputFile(splitPath, split.toYaml())

    output.log('')
    output.log(`Split out: ${summary}`)
    output.log(`  From:   ${follow.summary} (${entry.fileName})`)
    output.log(`  Docs:   stay with the original — the split follow captures from now on`)
    output.log(`  Follow: ${splitPath}`)
    output.log('')

    return CommandResult.success({ file: splitPath, from: entry.path })
  }
}

async function find(
  dir: string,
  identity: { channel: string; rootTs: string },
): Promise<{ entry: { path: string; fileName: string } } | undefined> {
  const registry = await SlackFollowRegistry.build(dir)
  const entry = registry.findByThreadRoot(identity.channel, identity.rootTs)
  return entry ? { entry: { path: entry.path, fileName: entry.fileName } } : undefined
}
