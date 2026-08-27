import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import { consolidateFusedDocs } from '#commands/all/slack/lib/consolidateFusedDocs.ts'
import { SLACK_ENRICH } from '#commands/all/slack/lib/enrich.ts'
import { resolveRecipient } from '#commands/all/slack/lib/mod.ts'
import parseMessageLink from '#commands/all/slack/lib/parseMessageLink.ts'
import { summarizeSlackMessage } from '#commands/all/slack/lib/summarize.ts'
import type { CommandTypesRegistry } from '#commands/lib/core/CommandTypesRegistry.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, CommandService, InferParams } from '#commands/mod.ts'
import { DIR_BASE, DIR_STATE_FOLLOW_SLACK_ACTIVE } from '#config'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { autoRelMessage } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import slugify from '#lib/string/slugify.ts'
import { outputFile, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import Follow, { type FollowMessage } from '#shared/models/Follow/mod.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import { computePreviousRef, convertToNotebookTimezone, fetchNowSync, toTimeRef } from '#shared/nbfs/mod.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { findCapturedThread } from './mod.ts'

const params = {
  link1: Arg.string('First Slack message link'),
  link2: Arg.string('Second Slack message link', { position: 1 }),
  link3: Arg.string('Third Slack message link', { position: 2, optional: true }),
  link4: Arg.string('Fourth Slack message link', { position: 3, optional: true }),
  noEditor: Flag.bool('Skip opening editors for created files', { hidden: true, default: false }),
}

type Params = InferParams<typeof params>
type Result = {
  /** The merged follow YAML path */
  file: string
  /** How many previously separate conversations were fused (a fresh combined capture counts as one) */
  fused: number
  /** Notebook-relative paths of docs written for previously uncaptured links */
  slackFiles: string[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:follow:message:merge': {
      params: Params
      result: Result
    }
  }
}

type ExportData = NonNullable<CommandTypesRegistry['slack:cli:export']['result']>

/** The root ts an anchor names — thread_ts when present, else the ts in its link. */
export function anchorTs(anchor: Record<string, string>): string {
  if (anchor.thread_ts) return anchor.thread_ts
  const digits = anchor.link?.match(/\/p(\d{10,})(?:[?#]|$)/)?.[1]
  return digits ? `${digits.slice(0, -6)}.${digits.slice(-6)}` : ''
}

/** Anchor identity for dedupe: channel + root ts. */
function anchorKey(anchor: Record<string, string>): string {
  return `${anchor.channel}|${anchorTs(anchor)}`
}

export default class SlackFollowMessageMergeTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:follow:message:merge',
    description: 'Merge two or more Slack messages/threads into one followed conversation.',
    descriptionLong: [
      'The system never guesses conversation boundaries — this is how you name',
      'them. Links to uncaptured messages are captured together as one doc',
      'chain; links into already-captured follows fuse those follows into one',
      'record whose check watches every anchor. Same-day doc fragments combine',
      'into one file with one title; docs never move across days.',
      '',
      'Merging is incremental: to add a link later, merge it with any link',
      'already in the conversation. Re-running merge on links that already',
      'share a conversation re-consolidates its docs — the repair verb.',
    ],
    usage: [
      'sky slack:follow:message:merge "https://ws.slack.com/archives/C01/p123…" "https://ws.slack.com/archives/C01/p456…"',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const links = [args.link1, args.link2, args.link3, args.link4].filter((l): l is string => Boolean(l))

    // 1. Resolve each link to the follow that owns it, or to a fresh export
    const owned = new Map<string, { path: string; ledger: 'active' | 'archive' }>()
    const fresh = new Map<string, { anchor: Record<string, string>; data: ExportData }>()
    for (const link of links) {
      let owner = await findCapturedThread(link, parseMessageLink(link))
      if (!owner) {
        const exportResult = await tasks.run('slack:cli:export', { link })
        if (!exportResult.ok || !exportResult.data) {
          return CommandResult.fail(`Failed to export ${link}: ${exportResult.message}`)
        }
        const data = exportResult.data
        // The link alone may not have named its root — re-check now that it has
        owner = await findCapturedThread(link, { channelId: data.channelId, rootTs: data.threadTs ?? data.messageTs })
        if (!owner) {
          const anchor = {
            channel: data.channelId,
            ...(data.threadTs ? { thread_ts: data.threadTs } : {}),
            link: data.link,
          }
          fresh.set(anchorKey(anchor), { anchor, data })
          continue
        }
      }
      owned.set(owner.path, { path: owner.path, ledger: owner.ledger })
    }

    if (owned.size + fresh.size < 2) {
      // All links live in one follow already. If it's a merged conversation,
      // re-running merge is the repair verb: consolidate its docs in place.
      if (owned.size === 1) {
        const { path: p } = [...owned.values()][0]
        const existing = Follow.fromYaml(await readTextFile(p))
        if (existing.merged.length > 0) {
          const slug = path.basename(p).replace(/\.ya?ml$/, '')
          const consolidated = await consolidateFusedDocs(existing, slug, { output })
          await outputFile(p, consolidated.toYaml())
          output.log(`Already one conversation — docs consolidated: ${consolidated.summary}`)
          return CommandResult.success({ file: p, fused: 1, slackFiles: [] })
        }
      }
      return CommandResult.fail('Nothing to merge — the links resolve to a single conversation.')
    }

    // 2. Capture all fresh links together as one conversation
    const slackFiles: string[] = []
    const follows: { follow: Follow; path: string }[] = []
    if (fresh.size > 0) {
      const captured = await captureTogether([...fresh.values()], args.noEditor ?? false, tasks, output)
      if (!captured.ok) return CommandResult.fail(captured.error)
      follows.push({ follow: captured.follow, path: captured.path })
      slackFiles.push(...captured.slackFiles)
    }
    for (const { path: p } of owned.values()) {
      follows.push({ follow: Follow.fromYaml(await readTextFile(p)), path: p })
    }

    // All links were uncaptured — the combined capture IS the merge
    if (follows.length === 1) {
      const only = follows[0]
      output.log(`Captured ${fresh.size} threads as one conversation: ${only.follow.summary}`)
      return CommandResult.success({ file: only.path, fused: 1, slackFiles })
    }

    // 3. Fuse: the earliest anchor is the conversation's start and keeps its
    //    identity; everything else becomes a merged anchor. Docs stay put —
    //    the fused record only changes where future activity lands.
    follows.sort((a, b) => (anchorTs(a.follow.ref) < anchorTs(b.follow.ref) ? -1 : 1))
    const [primary, ...rest] = follows

    const mergedAnchors: Record<string, string>[] = [...primary.follow.merged]
    const seen = new Set([anchorKey(primary.follow.ref), ...mergedAnchors.map(anchorKey)])
    for (const { follow } of rest) {
      for (const anchor of [follow.ref, ...follow.merged]) {
        const key = anchorKey(anchor)
        if (!seen.has(key)) {
          seen.add(key)
          mergedAnchors.push(anchor)
        }
      }
    }

    const allMessages: FollowMessage[] = follows
      .flatMap((f) => f.follow.messages)
      .sort((a, b) => (a.date < b.date ? -1 : 1))

    // The fused lastChecked is the OLDEST of the parts, so replies none of
    // them had seen yet are still picked up. A reply a newer part already
    // captured may append once more — the cheap side of that trade.
    const lastCheckeds = follows
      .map((f) => f.follow.lastChecked)
      .filter((d): d is PlainDateTime => d !== undefined)
      .sort((a, b) => (`${a.date} ${a.time}` < `${b.date} ${b.time}` ? -1 : 1))

    let fused = primary.follow.withMerged(mergedAnchors).withMessages(allMessages).updateStatus('active')
    if (lastCheckeds.length > 0) fused = fused.updateLastChecked(lastCheckeds[0])

    // 4. Make the docs read as one conversation: same-day fragments combine
    //    into one file, every surviving doc carries the fused identity
    const fusedPath = path.join(DIR_STATE_FOLLOW_SLACK_ACTIVE, path.basename(primary.path))
    const slug = path.basename(fusedPath).replace(/\.ya?ml$/, '')
    fused = await consolidateFusedDocs(fused, slug, { output })

    // 5. The fused record lives in the active ledger; the absorbed ones go away
    await outputFile(fusedPath, fused.toYaml())
    for (const { path: p } of follows) {
      if (p !== fusedPath) await unlink(p)
    }

    output.log('')
    output.log(`Merged ${follows.length} conversations into: ${fused.summary}`)
    output.log(`  Anchors: ${1 + mergedAnchors.length}`)
    output.log(`  Docs:    ${fused.messages.length} (same-day fragments combined)`)
    output.log(`  Follow:  ${fusedPath}`)
    output.log('')

    return CommandResult.success({ file: fusedPath, fused: follows.length, slackFiles })
  }
}

type FileRef = { mimetype?: string; mode?: string; path: string }
type Msg = { timeLabel: string; userName: string; text: string; files: FileRef[] }

/** Capture N uncaptured threads as a single conversation: one summary, one doc chain, one follow. */
async function captureTogether(
  fresh: { anchor: Record<string, string>; data: ExportData }[],
  noEditor: boolean,
  tasks: CommandService,
  output: OutputHandler,
): Promise<{ ok: true; follow: Follow; path: string; slackFiles: string[] } | { ok: false; error: string }> {
  const collect = (data: ExportData): Msg[] => [
    {
      timeLabel: data.message.timeLabel || '',
      userName: data.message.userName || '-',
      text: data.message.text?.trim() || '(empty)',
      files: data.message.files ?? [],
    },
    ...(data.thread?.replies ?? []).map((r) => ({
      timeLabel: r.timeLabel || r.ts || '',
      userName: r.userName || r.userId || '-',
      text: r.text || '(empty)',
      files: r.files ?? [],
    })),
  ]

  fresh.sort((a, b) => (anchorTs(a.anchor) < anchorTs(b.anchor) ? -1 : 1))
  const earliest = fresh[0].data
  const messages = fresh.flatMap((f) => collect(f.data)).sort((a, b) => (a.timeLabel < b.timeLabel ? -1 : 1))

  // Summarize over the whole merged conversation, not just the first thread
  const summary =
    (await summarizeSlackMessage(
      { text: messages[0].text, userName: messages[0].userName },
      messages.slice(1).map((m) => ({ text: m.text, userName: m.userName })),
    )) ?? 'Merged conversation'
  const from = earliest.message.userName
  const channel = earliest.channelName || earliest.channelId
  const to = resolveRecipient(earliest, from)
  const when = earliest.message.timeLabel
    ? await convertToNotebookTimezone(earliest.message.timeLabel)
    : fetchNowSync().plainDateTime

  const channelSlug = slugify(channel, { preserveCase: true })
  const summarySlug = slugify(summary, { preserveCase: true, suggestedLength: 40 })
  const fileName = `${when.plainDate.toString()}_slack_${channelSlug}_${summarySlug}.yaml`
  const fileNameNoExt = fileName.replace(/\.yaml$/, '')

  const renderBody = (msgs: Msg[]): string =>
    [`# ${summary}`, '', ...msgs.flatMap((m) => [`## ${m.timeLabel} - **${m.userName}**`, '', m.text, '', ''])].join(
      '\n',
    )

  // One classification over the whole conversation; every day doc gets it
  const enrichInput = { to, from, summary, body: renderBody(messages) }
  const [tags, rel] = await Promise.all([
    autoTagMessage(enrichInput, SLACK_ENRICH),
    autoRelMessage(enrichInput, SLACK_ENRICH),
  ])
  if (tags) output.log(`  Auto-tags: ${tags}`)
  if (rel) output.log(`  Auto-rel: ${rel.join('; ')}`)

  // Group by notebook day; one doc per day, chained like a smart split
  const byDay = new Map<string, { msgs: Msg[]; when: PlainDateTime }>()
  for (const msg of messages) {
    const msgWhen = msg.timeLabel ? await convertToNotebookTimezone(msg.timeLabel) : when
    const day = msgWhen.plainDate.toString()
    if (!byDay.has(day)) byDay.set(day, { msgs: [], when: msgWhen })
    byDay.get(day)!.msgs.push(msg)
  }

  const written: FollowMessage[] = []
  const realPaths: string[] = []
  for (const [day, dayGroup] of [...byDay.entries()].sort()) {
    const previous =
      realPaths.length > 0 ? computePreviousRef(realPaths[realPaths.length - 1], dayGroup.when.plainDate) : undefined
    const dayFiles = dayGroup.msgs.flatMap((m) => m.files)
    const slackResult = await tasks.run('slack:new', {
      from,
      to,
      summary,
      when: dayGroup.when,
      markdown: renderBody(dayGroup.msgs),
      follow: fileNameNoExt,
      link: earliest.message.permalink ?? fresh[0].anchor.link,
      ...(tags ? { tags } : { noAutoTag: true }),
      noAutoRel: true,
      ...(previous ? { previous } : {}),
      ...(dayFiles.length > 0 ? { slackFiles: JSON.stringify(dayFiles) } : {}),
      noEditor: true,
    })
    const relPath = slackResult.ok ? slackResult.data?.filePath : undefined
    if (!relPath) {
      return { ok: false, error: `Failed to write ${day}: ${slackResult.ok ? 'no file path' : slackResult.message}` }
    }
    const ddfw = new DayDirFileWriter(dayGroup.when.plainDate)
    const timePath = `time/${ddfw.dayDir}/${relPath}`
    written.push({ date: day, path: toTimeRef(timePath) })
    realPaths.push(timePath)
    output.log(`  ${day}: ${relPath} (${dayGroup.msgs.length} message${dayGroup.msgs.length > 1 ? 's' : ''})`)

    // rel is an array, which the slack:new string param can't carry — patch it on
    if (rel) {
      try {
        const absPath = path.join(DIR_BASE, timePath)
        const doc = MessageDocument.fromMarkdown(await readTextFile(absPath))
        await writeTextFile(absPath, new MessageDocument({ ...doc.yaml, rel }, doc.markdown).toMarkdown())
      } catch {
        /* day file unreadable — leave rel absent */
      }
    }
  }

  const now = fetchNowSync().plainDateTime
  const lastMsg = messages[messages.length - 1]
  const lastActivity = lastMsg?.timeLabel ? await convertToNotebookTimezone(lastMsg.timeLabel) : when
  const follow = Follow.create({
    source: 'Slack',
    ref: fresh[0].anchor,
    merged: fresh.slice(1).map((f) => f.anchor),
    summary,
    followSince: now,
    lastChecked: now,
    lastActivity,
    messages: written,
    status: 'active',
  })
  const followPath = path.join(DIR_STATE_FOLLOW_SLACK_ACTIVE, fileName)
  await outputFile(followPath, follow.toYaml())

  if (realPaths.length > 0 && !noEditor) {
    openEditor(realPaths.map((p) => ({ file: path.join(DIR_BASE, p) })))
    await delay(500)
  }

  return { ok: true, follow, path: followPath, slackFiles: realPaths }
}
