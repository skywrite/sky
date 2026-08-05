import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import exists from './exists.ts'
import writeTextFile from './writeTextFile.ts'

test('exists returns true for existing file', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'exists-test-'))
  const filePath = path.join(tempDir, 'test.txt')

  await writeTextFile(filePath, 'hello')

  const actual = await exists(filePath)

  assert({
    given: 'an existing file',
    should: 'return true',
    actual,
    expected: true,
  })

  await rm(tempDir, { recursive: true })
})

test('exists returns false for non-existent file', async () => {
  const filePath = '/tmp/non-existent-file-abc123.txt'

  const actual = await exists(filePath)

  assert({
    given: 'a non-existent file',
    should: 'return false',
    actual,
    expected: false,
  })
})

test('exists returns true for existing directory', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'exists-test-'))

  const actual = await exists(tempDir)

  assert({
    given: 'an existing directory',
    should: 'return true',
    actual,
    expected: true,
  })

  await rm(tempDir, { recursive: true })
})

test('exists returns false for non-existent directory', async () => {
  const dirPath = '/tmp/non-existent-dir-abc123'

  const actual = await exists(dirPath)

  assert({
    given: 'a non-existent directory',
    should: 'return false',
    actual,
    expected: false,
  })
})
