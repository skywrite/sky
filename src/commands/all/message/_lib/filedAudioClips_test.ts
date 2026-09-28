import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { hash } from '#lib/outbox/files.ts'
import { assert, test } from '#test'
import { filedClips, forgetFiledClips, recordFiledClips } from './filedAudioClips.ts'

const ONE = 'time/2026/W05/01-27/actions/messages/09-30_iMessage-Audio_Atlas.md'
const TWO = 'time/2026/W05/01-28/actions/messages/14-00_iMessage-Audio_Widget-V2.md'

test('a clip is remembered per conversation, an unreadable record counts as new, and undo forgets', async () => {
  const root = await mkdtemp('/tmp/sky-filed-clips-')
  const paths = { DIR_STATE: path.join(root, 'state') }
  const dir = path.join(paths.DIR_STATE, 'transcript', 'filed')
  const [a, b, broken, unknown] = ['first clip', 'second clip', 'broken', 'unknown'].map(hash)
  try {
    await recordFiledClips(paths, ONE, [a, b, a])
    await Promise.all([recordFiledClips(paths, TWO, [a]), recordFiledClips(paths, TWO, [a])])
    await writeFile(path.join(dir, `${broken}.json`), '{not json')
    const before = [
      [...(await filedClips(paths, ONE, [a, b, broken, unknown]))],
      [...(await filedClips(paths, TWO, [a, b]))],
      JSON.parse(await readFile(path.join(dir, `${a}.json`), 'utf8')),
    ]
    await forgetFiledClips(paths, ONE, [a, b, unknown])
    const after = [
      [...(await filedClips(paths, ONE, [a, b]))],
      [...(await filedClips(paths, TWO, [a]))],
      (await readdir(dir)).toSorted(),
    ]
    assert({
      given: 'clips recorded for two conversations, one repeated, beside a record that is not JSON',
      should: 'answer per conversation, list each conversation once, and drop records nothing refers to',
      actual: { before, after },
      expected: {
        before: [[a, b], [a], { conversations: [ONE, TWO] }],
        after: [[], [a], [`${a}.json`, `${broken}.json`].toSorted()],
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
