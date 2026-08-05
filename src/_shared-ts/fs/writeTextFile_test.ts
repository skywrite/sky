import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import readTextFile from './readTextFile.ts'
import writeTextFile from './writeTextFile.ts'

test('writeTextFile creates file with content', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'writeTextFile-test-'))
  const filePath = path.join(tempDir, 'test.txt')

  const content = 'Hello, World!'
  await writeTextFile(filePath, content)

  const actual = await readTextFile(filePath)

  assert({
    given: 'content to write',
    should: 'create file with that content',
    actual,
    expected: content,
  })

  await rm(tempDir, { recursive: true })
})

test('writeTextFile overwrites existing file', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'writeTextFile-test-'))
  const filePath = path.join(tempDir, 'overwrite.txt')

  await writeTextFile(filePath, 'Original content')
  await writeTextFile(filePath, 'New content')

  const actual = await readTextFile(filePath)

  assert({
    given: 'an existing file',
    should: 'overwrite with new content',
    actual,
    expected: 'New content',
  })

  await rm(tempDir, { recursive: true })
})

test('writeTextFile handles UTF-8 characters', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'writeTextFile-test-'))
  const filePath = path.join(tempDir, 'unicode.txt')

  const content = 'Hello 世界 🌍 émojis'
  await writeTextFile(filePath, content)

  const actual = await readTextFile(filePath)

  assert({
    given: 'UTF-8 content',
    should: 'write and preserve unicode characters',
    actual,
    expected: content,
  })

  await rm(tempDir, { recursive: true })
})

test('writeTextFile handles empty string', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'writeTextFile-test-'))
  const filePath = path.join(tempDir, 'empty.txt')

  await writeTextFile(filePath, '')

  const actual = await readTextFile(filePath)

  assert({
    given: 'an empty string',
    should: 'create an empty file',
    actual,
    expected: '',
  })

  await rm(tempDir, { recursive: true })
})

test('writeTextFile handles large content', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'writeTextFile-test-'))
  const filePath = path.join(tempDir, 'large.txt')

  const content = 'x'.repeat(100000)
  await writeTextFile(filePath, content)

  const actual = await readTextFile(filePath)

  assert({
    given: 'large content (100KB)',
    should: 'write all content correctly',
    actual: actual.length,
    expected: 100000,
  })

  await rm(tempDir, { recursive: true })
})
