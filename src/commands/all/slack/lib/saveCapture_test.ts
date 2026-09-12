import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import MessageDocument from '#shared/models/Message/mod.ts'
import { assert, test } from '#test'
import { saveSlackCaptureUpdate } from './saveCapture.ts'

test('A Slack save preserves edits made while voice recognition was running', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-save-conflict-'))
  try {
    const file = path.join(temp, 'atlas.md')
    const original = new MessageDocument({ summary: 'Atlas' }, '# Atlas\n\nOriginal message.\n')
    const prepared = new MessageDocument(original.yaml, original.markdown + '\nTranscript.\n')
    const edited = original.toMarkdown() + '\nA note added during recognition.\n'
    await writeFile(file, edited)
    let failed = false
    try {
      await saveSlackCaptureUpdate(file, original, prepared)
    } catch {
      failed = true
    }
    assert({
      given: 'a concurrent edit after capture preparation began',
      should: 'refuse the stale save and retain the new note',
      actual: [failed, await readFile(file, 'utf8')],
      expected: [true, edited],
    })
    const current = MessageDocument.fromMarkdown(edited)
    const retried = new MessageDocument(current.yaml, current.markdown + '\nTranscript.\n')
    await saveSlackCaptureUpdate(file, current, retried)
    assert({
      given: 'an update prepared from the current document',
      should: 'save the transcript along with the note',
      actual: await readFile(file, 'utf8'),
      expected: retried.toMarkdown(),
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
