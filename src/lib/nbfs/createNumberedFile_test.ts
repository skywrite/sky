import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { createNumberedFile } from './createNumberedFile.ts'

test('createNumberedFile() numbers namesakes and never overwrites', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-numbered-file-'))
  try {
    const first = await createNumberedFile(path.join(dir, 'ja'), 'Jane-Doe', 'first\n')
    const second = await createNumberedFile(path.join(dir, 'ja'), 'Jane-Doe', 'second\n')
    await writeFile(path.join(dir, 'ja', 'jane-doe-3.md'), 'taken\n')
    const fourth = await createNumberedFile(path.join(dir, 'ja'), 'Jane-Doe', 'fourth\n')
    assert({
      given: 'three new files with one name, and a differently cased third name already taken',
      should: 'create the name, then -2, then skip to -4, keeping every earlier file',
      actual: [
        path.relative(dir, first),
        path.relative(dir, second),
        path.relative(dir, fourth),
        await readFile(first, 'utf8'),
        await readFile(path.join(dir, 'ja', 'jane-doe-3.md'), 'utf8'),
      ],
      expected: ['ja/Jane-Doe.md', 'ja/Jane-Doe-2.md', 'ja/Jane-Doe-4.md', 'first\n', 'taken\n'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
