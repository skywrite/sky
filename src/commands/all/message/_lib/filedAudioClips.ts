/**
 * Which conversations each audio clip has a turn in, kept in Sky's state
 * directory so a repeated drop or a retried import adds a clip once. The
 * conversation file carries no fingerprint: it is the person's document, and
 * a hash means nothing to whoever reads it. (Until 2026-09-28 the hashes sat
 * in an `audioClips` frontmatter list that the properties panel hid.)
 *
 * One JSON record per clip under DIR_STATE/transcript/filed, named by the
 * sha256 of the clip's bytes — the transcript run's key — listing the
 * notebook-relative paths of the conversations holding a turn from it. The
 * record outlives the run: the run is forgotten when the door files the
 * document, and the record is what a later drop of the same clip finds. A
 * missing or unreadable record means the clip is new; the worst a lost record
 * can do is admit a duplicate turn, which Undo removes.
 */

import { readFile, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { atomicWrite } from '#lib/outbox/files.ts'

export interface FiledClipPaths {
  DIR_STATE: string
}

interface FiledClip {
  conversations: string[]
}

function recordFile(paths: FiledClipPaths, hash: string): string {
  return path.join(paths.DIR_STATE, 'transcript', 'filed', `${hash}.json`)
}

async function conversationsOf(file: string): Promise<string[]> {
  try {
    const record = JSON.parse(await readFile(file, 'utf8')) as Partial<FiledClip>
    return Array.isArray(record.conversations) ? record.conversations.filter((c) => typeof c === 'string') : []
  } catch {
    return []
  }
}

async function save(file: string, conversations: string[]): Promise<void> {
  if (conversations.length) await atomicWrite(file, `${JSON.stringify({ conversations }, null, 2)}\n`)
  else await rm(file, { force: true })
}

/** Of these clips, the ones that already have a turn in the conversation. */
export async function filedClips(paths: FiledClipPaths, conversation: string, hashes: string[]): Promise<Set<string>> {
  const filed = new Set<string>()
  await Promise.all(
    [...new Set(hashes)].map(async (hash) => {
      if ((await conversationsOf(recordFile(paths, hash))).includes(conversation)) filed.add(hash)
    }),
  )
  return filed
}

/** Remember that each clip now has a turn in the conversation. */
export async function recordFiledClips(paths: FiledClipPaths, conversation: string, hashes: string[]): Promise<void> {
  await Promise.all(
    [...new Set(hashes)].map(async (hash) => {
      const file = recordFile(paths, hash)
      const conversations = await conversationsOf(file)
      if (!conversations.includes(conversation)) await save(file, [...conversations, conversation])
    }),
  )
}

/** Forget the clips' turns in the conversation, after an undo removed them. */
export async function forgetFiledClips(paths: FiledClipPaths, conversation: string, hashes: string[]): Promise<void> {
  await Promise.all(
    [...new Set(hashes)].map(async (hash) => {
      const file = recordFile(paths, hash)
      const conversations = await conversationsOf(file)
      if (conversations.includes(conversation))
        await save(
          file,
          conversations.filter((c) => c !== conversation),
        )
    }),
  )
}
