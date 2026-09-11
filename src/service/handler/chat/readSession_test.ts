import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { writeChatAutosave } from '#shared/models/Chat/ChatStore/autosave.ts'
import { loadResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { setUserSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { readSession } from './readSession.ts'

setUserSpeakerLabel('Jane')

test('readSession restores a complete snapshot off the server thread', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-read-session-test-'))
  const filePath = path.join(dir, 'sample.md')
  try {
    await writeChatAutosave(filePath, {
      turns: [
        { role: 'user', content: 'Sample request', when: '2026-01-27 09:30' },
        { role: 'assistant', content: 'Sample reply', when: '2026-01-27 09:31' },
      ],
      contextLog: [{ turn: 1, queries: [] }],
      resume: null,
      startTime: new PlainDateTime('2026-01-27 09:30'),
      provider: 'sample',
      model: 'sample-model',
      recovery: { version: 1, modelMessages: [{ role: 'user', content: 'Sample request' }], host: { saves: false } },
    })
    const options = { baseDir: dir, snapshot: true }
    assert({
      given: 'a chat snapshot with conversation and provider history',
      should: 'return the same continuation state from the worker as the shared reader',
      actual: await readSession(filePath, options),
      expected: await loadResumeSession(filePath, options),
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
