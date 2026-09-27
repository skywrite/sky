import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { hash } from '#lib/outbox/files.ts'
import { readMarkdownContent, saveMarkdownContent } from '#service/handler/markdown-preview/content.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import { assert, test } from '#test'
import {
  appendAudioConversation,
  audioClipHashes,
  listAudioConversations,
  readAudioConversation,
  undoAudioAppend,
} from './savedAudioConversation.ts'

const RELATIVE = 'time/2026/W05/01-27/actions/messages/09-30_iMessage-Audio_Atlas.md'
const ORIGINAL =
  '---\n# Keep this comment\nfrom: Jane Doe\nto: Me\nwhen: 2026-01-27 09:30\nmedium: iMessage Audio\nsummary: Atlas plan\nrel:\n  - projects/Atlas\ncustom: Keep this too\n---\n\n**Jane Doe:**\n\nThe [plan][p] is ready.\n\n[p]: https://example.com/plan\n'
const addition = (words: string, speaker = 'Me') => ({
  hash: hash(words),
  speaker,
  body: `**${speaker}:**\n\n${words}`,
})

async function world() {
  const root = await mkdtemp('/tmp/sky-audio-append-')
  const paths = { DIR_BASE: root, DIR_TIME: path.join(root, 'time') }
  const file = path.join(root, RELATIVE)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, ORIGINAL)
  return { paths, root, file, close: () => rm(root, { recursive: true, force: true }) }
}

test('audio additions preserve the current body, references and metadata, and can be undone exactly', async () => {
  const w = await world()
  try {
    await readAudioConversation(w.paths, RELATIVE)
    const edited = ORIGINAL.replace('is ready.', 'is ready after my edit.')
    await writeFile(w.file, edited)
    const result = await appendAudioConversation(
      w.paths,
      RELATIVE,
      [addition('I will review it.', 'Joe Smith')],
      ['projects/Atlas', 'projects/Widget-V2'],
    )
    const content = await readFile(w.file, 'utf8')
    const doc = MessageDocument.fromMarkdown(content)
    assert({
      given: 'an existing conversation edited while the new audio was being transcribed',
      should: 'preserve the edited body and append one named turn with merged links and participants',
      actual: [
        result.added,
        result.filePath === w.file,
        content.includes('# Keep this comment'),
        doc.yaml.custom,
        doc.summary,
        doc.when.toString(),
        doc.to,
        [...doc.rel],
        content.includes(edited.slice(edited.indexOf('\n---\n') + 5)),
        doc.markdown.endsWith('**Joe Smith:**\n\nI will review it.\n'),
        audioClipHashes(doc),
      ],
      expected: [
        1,
        true,
        true,
        'Keep this too',
        'Atlas plan',
        '2026-01-27 09:30',
        'Me, Joe Smith',
        ['projects/Atlas', 'projects/Widget-V2'],
        true,
        true,
        [hash('I will review it.')],
      ],
    })
    await undoAudioAppend(w.paths, RELATIVE, result.undo!)
    assert({
      given: 'an unchanged audio addition',
      should: 'undo to the exact prior file including comments and formatting',
      actual: await readFile(w.file, 'utf8'),
      expected: edited,
    })
  } finally {
    await w.close()
  }
})

test('concurrent audio additions and stale editor saves cannot overwrite or duplicate a turn', async () => {
  const w = await world()
  try {
    const editor = await readMarkdownContent(w.file)
    const first = addition('First reply.')
    const second = addition('Second reply.', 'Jane Doe')
    const results = await Promise.all([
      appendAudioConversation(w.paths, RELATIVE, [first]),
      appendAudioConversation(w.paths, RELATIVE, [first, second, second]),
    ])
    const beforeRetry = await readFile(w.file, 'utf8')
    const repeated = await appendAudioConversation(w.paths, RELATIVE, [second, first])
    let conflict = false
    try {
      await saveMarkdownContent(w.file, ORIGINAL + '\nA stale edit.', editor.version)
    } catch {
      conflict = true
    }
    const after = await readFile(w.file, 'utf8')
    assert({
      given: 'overlapping concurrent drops, a repeated drop, and an editor still holding the original version',
      should: 'save each unique clip once, keep retries byte-identical, and reject the stale editor save',
      actual: [
        results.reduce((n, r) => n + r.added, 0),
        repeated.added,
        conflict,
        after === beforeRetry,
        after.split('First reply.').length - 1,
        after.split('Second reply.').length - 1,
      ],
      expected: [2, 0, true, true, 1, 1],
    })
    const receipt = results.find((r) => r.undo)?.undo
    await writeFile(w.file, after + '\nA later edit.\n')
    let refused = false
    try {
      await undoAudioAppend(w.paths, RELATIVE, receipt!)
    } catch {
      refused = true
    }
    assert({
      given: 'a later edit after an audio addition',
      should: 'refuse an undo that would discard the edit',
      actual: [refused, (await readFile(w.file, 'utf8')).endsWith('A later edit.\n')],
      expected: [true, true],
    })
  } finally {
    await w.close()
  }
})

test('the conversation picker and writer admit only eligible notebook messages and cancellation leaves no change', async () => {
  const w = await world()
  try {
    await writeFile(path.join(path.dirname(w.file), 'other.md'), ORIGINAL.replace('iMessage Audio', 'Email'))
    await symlink(w.file, path.join(path.dirname(w.file), 'alias.md'))
    await mkdir(path.join(w.root, 'notes'))
    await writeFile(path.join(w.root, 'notes', 'fake.md'), ORIGINAL)
    const denied: boolean[] = []
    for (const relative of [
      RELATIVE.replace('09-30_iMessage-Audio_Atlas.md', 'other.md'),
      RELATIVE.replace('09-30_iMessage-Audio_Atlas.md', 'alias.md'),
      'notes/fake.md',
      '../outside.md',
    ]) {
      try {
        await appendAudioConversation(w.paths, relative, [addition('No.')])
        denied.push(false)
      } catch {
        denied.push(true)
      }
    }
    let cancelled = false
    try {
      await appendAudioConversation(w.paths, RELATIVE, [addition('No.')], [], AbortSignal.abort())
    } catch {
      cancelled = true
    }
    assert({
      given: 'audio and non-audio messages, symlinks, unrelated documents and a cancelled run',
      should: 'list only valid audio conversations on the chosen day and reject writes elsewhere',
      actual: [
        (await listAudioConversations(w.paths, '2026-01-27')).map((item) => [item.path, item.participants]),
        await listAudioConversations(w.paths, '2026-01-28'),
        denied,
        cancelled,
        await readFile(w.file, 'utf8'),
      ],
      expected: [[[RELATIVE, ['Jane Doe', 'Me']]], [], [true, true, true, true], true, ORIGINAL],
    })
  } finally {
    await w.close()
  }
})
