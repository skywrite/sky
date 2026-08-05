import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import outputFile from './outputFile.ts'
import readTextFileSync from './readTextFileSync.ts'

test('outputFile creates directories and writes file', async () => {
  const data = 'hello world'
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'outputFile-test-'))
  const file = path.join(tmpDir, 'some/really/long/path/name/file.txt')

  await outputFile(file, data)

  assert({
    given: 'a file path with nested directories',
    should: 'create directories and write data',
    actual: readTextFileSync(file),
    expected: data,
  })

  await rm(tmpDir, { recursive: true })
})

test('outputFile overwrites existing file', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'outputFile-test-'))
  const file = path.join(tmpDir, 'test.txt')

  await outputFile(file, 'first')
  await outputFile(file, 'second')

  assert({
    given: 'writing to an existing file',
    should: 'overwrite the content',
    actual: readTextFileSync(file),
    expected: 'second',
  })

  await rm(tmpDir, { recursive: true })
})

test('outputFile handles empty content', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'outputFile-test-'))
  const file = path.join(tmpDir, 'empty.txt')

  await outputFile(file, '')

  assert({
    given: 'empty content',
    should: 'create empty file',
    actual: readTextFileSync(file),
    expected: '',
  })

  await rm(tmpDir, { recursive: true })
})
