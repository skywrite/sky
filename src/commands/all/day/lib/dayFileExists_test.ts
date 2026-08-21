import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir, outputFile } from '#shared/fs/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayFileExists from './dayFileExists.ts'

test('dayFileExists', async () => {
  const day = new PlainDate(2022, 10, 29)
  const tempDir = await makeTempDir()

  assert({
    given: 'a time dir with no week directories',
    should: 'return false',
    expected: false,
    actual: await dayFileExists(day, tempDir),
  })

  await outputFile(path.join(tempDir, dayFile(day)), '# day')

  assert({
    given: 'a day file at the configured layout path',
    should: 'return true',
    expected: true,
    actual: await dayFileExists(day, tempDir),
  })

  await rm(tempDir, { recursive: true, force: true })
})
