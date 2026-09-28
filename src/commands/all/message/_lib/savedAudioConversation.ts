import { readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { parseDocument } from 'yaml'
import { withMarkdownWrite } from '#lib/nbfs/withMarkdownWrite.ts'
import { atomicWrite, missing, notebookFile } from '#lib/outbox/files.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { type FiledClipPaths, filedClips, forgetFiledClips, recordFiledClips } from './filedAudioClips.ts'

export interface AudioConversation {
  path: string
  title: string
  when: string
  participants: string[]
  preview: string
}

export interface AudioConversationPaths {
  DIR_BASE: string
  DIR_TIME: string
}

/** Writing a turn also records the clip in state; reading a conversation needs only the notebook */
export type AudioAppendPaths = AudioConversationPaths & FiledClipPaths

function participants(doc: MessageDocument): string[] {
  const names = [doc.from, doc.to].flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
  const voices = [...doc.markdown.matchAll(/^\*\*(.+):\*\*[ \t]*$/gm)].map((match) =>
    match[1].replace(/\\([\\`*_[\]<>])/g, '$1'),
  )
  return [...new Set([...names, ...voices].map((name) => name.trim()).filter(Boolean))]
}

export async function readAudioConversation(paths: AudioConversationPaths, relative: string) {
  // This operation only owns saved audio conversations, never an arbitrary notebook document.
  if (!relative.endsWith('.md') || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..'))
    throw new Error('Choose a saved iMessage Audio conversation.')
  const file = await notebookFile(paths.DIR_BASE, relative)
  const withinTime = path.relative(paths.DIR_TIME, file).split(path.sep)
  if (withinTime[0] === '..' || !withinTime.includes('messages') || !withinTime.includes('actions'))
    throw new Error('Choose a saved iMessage Audio conversation.')
  const content = await readFile(file, 'utf8')
  const doc = MessageDocument.fromMarkdown(content)
  if (doc.yamlError || doc.medium !== 'iMessage Audio')
    throw new Error('Choose a saved iMessage Audio conversation with valid frontmatter.')
  const when = doc.when.datetime?.toString()
  if (!when) throw new Error('The conversation needs a valid date and time.')
  const lastVoice = [...doc.markdown.matchAll(/^\*\*.+:\*\*[ \t]*$/gm)].at(-1)
  const preview = doc.markdown
    .slice(lastVoice?.index ?? 0)
    .trim()
    .slice(0, 600)
  const conversation: AudioConversation = {
    path: path.relative(paths.DIR_BASE, file),
    title: doc.summary || 'Audio conversation',
    when,
    participants: participants(doc),
    preview,
  }
  return { file, content, doc, conversation }
}

export async function listAudioConversations(paths: AudioConversationPaths, day: string): Promise<AudioConversation[]> {
  const date = new PlainDate(day)
  if (date.toString() !== day) throw new Error('Choose a valid day.')
  const dir = path.join(paths.DIR_TIME, dayDir(date), 'actions/messages')
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    if (missing(error)) return []
    throw error
  })
  const results = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map(async (entry) => {
        try {
          return (await readAudioConversation(paths, path.relative(paths.DIR_BASE, path.join(dir, entry.name))))
            .conversation
        } catch {
          // Other message media and malformed documents are not append destinations.
          return null
        }
      }),
  )
  return results
    .filter((item): item is AudioConversation => item !== null)
    .sort((a, b) => a.when.localeCompare(b.when) || a.path.localeCompare(b.path))
}

export interface AudioAddition {
  hash: string
  speaker: string
  body: string
}

export interface AudioAppendUndo {
  before: string
  after: string
  /** The clips the addition filed, so undo can forget them */
  hashes: string[]
}

/** Re-read after transcription: preserve edits and serialize simultaneous additions with browser saves. */
export async function appendAudioConversation(
  paths: AudioAppendPaths,
  relative: string,
  additions: AudioAddition[],
  rel: string[] = [],
  signal?: AbortSignal,
): Promise<{ filePath: string; added: number; undo?: AudioAppendUndo }> {
  const target = await readAudioConversation(paths, relative)
  return withMarkdownWrite(target.file, async () => {
    signal?.throwIfAborted()
    const current = await readAudioConversation(paths, relative)
    const conversation = current.conversation.path
    const known = await filedClips(
      paths,
      conversation,
      additions.map((addition) => addition.hash),
    )
    const fresh = additions.filter((addition) => {
      if (known.has(addition.hash)) return false
      known.add(addition.hash)
      return true
    })
    if (!fresh.length) return { filePath: current.file, added: 0 }
    // Editing the YAML syntax tree keeps comments and unknown fields. The body is copied verbatim.
    const header = /^(\ufeff?---\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[^\S\r\n]*(?:\r?\n|$))/.exec(current.content)
    if (!header) throw new Error('The conversation needs valid frontmatter.')
    const yaml = parseDocument(header[2])
    if (yaml.errors.length) throw new Error('The conversation needs valid frontmatter.')
    const others = [...new Set([...current.conversation.participants, ...fresh.map((turn) => turn.speaker)])].filter(
      (name) => name !== current.doc.from,
    )
    if (others.length) yaml.set('to', others.join(', '))
    if (rel.length) yaml.set('rel', [...new Set([...current.doc.rel, ...rel])])
    const body = current.content.slice(header[0].length)
    const separator = body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n'
    const content = `${header[1]}${yaml.toString().trimEnd()}${header[3]}${body}${separator}${fresh.map((turn) => turn.body).join('\n\n')}\n`
    signal?.throwIfAborted()
    await atomicWrite(current.file, content)
    // Recorded after the write: a clip counts as filed only once its turn is in the file.
    const hashes = fresh.map((turn) => turn.hash)
    await recordFiledClips(paths, conversation, hashes)
    return { filePath: current.file, added: fresh.length, undo: { before: current.content, after: content, hashes } }
  })
}

export async function undoAudioAppend(paths: AudioAppendPaths, relative: string, undo: AudioAppendUndo): Promise<void> {
  const target = await readAudioConversation(paths, relative)
  await withMarkdownWrite(target.file, async () => {
    const current = await readAudioConversation(paths, relative)
    if (current.content !== undo.after)
      throw new Error('The conversation has changed since the audio was added. Open it to remove the added messages.')
    await atomicWrite(current.file, undo.before)
    await forgetFiledClips(paths, current.conversation.path, undo.hashes)
  })
}
