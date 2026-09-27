import * as path from 'node:path'
import type { CommandTypesRegistry } from '#commands/lib/core/CommandTypesRegistry.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import type { CommandService } from '#commands/mod.ts'
import { DIR_BASE } from '#config'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { atomicWrite } from '#lib/outbox/files.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import Follow from '#shared/models/Follow/mod.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import { computePreviousRef, convertToNotebookTimezone, fetchNow, resolveTimeRef, toTimeRef } from '#shared/nbfs/mod.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { captureMessages } from './captureMessages.ts'
import resolveRecipient from './resolveRecipient.ts'
import { saveSlackCaptureUpdate } from './saveCapture.ts'
import { syncSlackFollow } from './syncFollow.ts'
import { clearSavedVoiceTranscripts } from './transcribeVoiceMemo.ts'
import { updateSlackCapture } from './updateCapture.ts'

export type SlackFollowEntry = { follow: Follow; path: string; fileName: string }

export type SlackFollowPoll =
  /** An anchor's export failed — nothing was saved and the record is untouched */
  | { ok: false; failures: { link: string; message: string }[] }
  | {
      ok: true
      /** The follow as checkpointed back to its record */
      follow: Follow
      newReplies: number
      /** Time refs of the capture files this poll created or changed */
      written: string[]
    }

/** The roots a follow polls: its ref plus any merged anchors, each by its link. */
export function followAnchors(follow: Follow): Record<string, string>[] {
  return [follow.ref, ...follow.merged].filter((anchor) => anchor.link)
}

/**
 * Poll one follow and checkpoint its record in place, whichever ledger holds
 * it. Replies the notebook lacks are saved on their own notebook day, linked
 * back to the previous capture. Callers decide which follows are due and
 * where a record belongs afterwards.
 */
export async function pollSlackFollow(
  entry: SlackFollowEntry,
  deps: { tasks: CommandService; output: OutputHandler; signal?: AbortSignal; now: PlainDateTime },
): Promise<SlackFollowPoll> {
  const { tasks, output, signal, now } = deps
  const { path: followPath, fileName } = entry
  let { follow } = entry

  const anchors = followAnchors(follow)
  if (anchors.length === 0) throw new Error(`${fileName}: no link to poll`)

  // One export per anchor — a merged follow watches several roots and
  // gathers their activity into one stream
  const exports: NonNullable<CommandTypesRegistry['slack:cli:export']['result']>[] = []
  const failures: { link: string; message: string }[] = []
  for (const anchor of anchors) {
    const exportResult = await tasks.run('slack:cli:export', { link: anchor.link })
    if (!exportResult.ok || !exportResult.data) {
      failures.push({ link: anchor.link, message: exportResult.message ?? 'no message' })
      continue
    }
    exports.push(exportResult.data)
  }
  if (failures.length > 0) return { ok: false, failures }
  const data = exports[0]

  const written: string[] = []
  const synced = await syncSlackFollow(follow, exports.flatMap(captureMessages), {
    read: async (ref) => MessageDocument.fromMarkdown(await readTextFile(path.join(DIR_BASE, resolveTimeRef(ref)))),
    notebookTime: convertToNotebookTimezone,
    saveFollow: async (pending) => atomicWrite(followPath, pending.toYaml()),
    update: async (ref, doc, messages, day) => {
      const transcriptRuns = new Set<string>()
      const updated = await updateSlackCapture({ doc, messages, day, output, signal, transcriptRuns })
      if (updated.toMarkdown() !== doc.toMarkdown()) {
        await saveSlackCaptureUpdate(path.join(DIR_BASE, resolveTimeRef(ref)), doc, updated)
        written.push(ref)
      }
      await clearSavedVoiceTranscripts(transcriptRuns, output)
    },
    create: async ({ messages, when, previous, inherit }) => {
      const from = messages[0].userName || messages[0].userId || '-'
      const inheritedTags = inherit?.yaml['tags']
      const inheritedRel = inherit?.yaml['rel']
      const result = await tasks.run('slack:new', {
        from,
        to: resolveRecipient(data, from),
        summary: follow.summary,
        when,
        slackMessages: JSON.stringify(messages),
        follow: fileName,
        link: data.message.permalink ?? data.link,
        previous: previous ? computePreviousRef(resolveTimeRef(previous), when.plainDate) : undefined,
        noEditor: true,
        ...(typeof inheritedTags === 'string' ? { tags: inheritedTags } : {}),
        ...(typeof inheritedRel === 'string' ? { rel: inheritedRel } : {}),
        ...(Array.isArray(inheritedRel) ? { noAutoRel: true } : {}),
      })
      if (!result.ok || !result.data?.filePath)
        throw new Error(`Failed to save Slack replies: ${result.message ?? 'no file path'}`)
      const ddfw = new DayDirFileWriter(when.plainDate)
      const timePath = `time/${ddfw.dayDir}/${result.data.filePath}`
      if (Array.isArray(inheritedRel)) {
        const fullPath = path.join(DIR_BASE, timePath)
        const doc = MessageDocument.fromMarkdown(await readTextFile(fullPath))
        await atomicWrite(fullPath, new MessageDocument({ ...doc.yaml, rel: inheritedRel }, doc.markdown).toMarkdown())
      }
      const ref = toTimeRef(timePath)
      written.push(ref)
      return ref
    },
  })
  follow = synced.follow

  // Checkpoint the start of the poll, not its completion: replies can
  // arrive while files are being downloaded or written.
  const checkedAt = (await fetchNow()).plainDateTime
  const activity = synced.lastActivity ?? follow.followSince
  const checkpointed = (synced.lastActivity ? follow.updateLastActivity(synced.lastActivity) : follow)
    .updateLastChecked(now)
    .updateCheckInterval(Follow.backoffInterval(checkedAt, activity))
  await atomicWrite(followPath, checkpointed.toYaml())

  return { ok: true, follow: checkpointed, newReplies: synced.newReplies, written }
}
