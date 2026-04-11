import { assert, test } from '#test'
import * as path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import readTextFile from './readTextFile.ts'
import writeTextFile from './writeTextFile.ts'

test('readTextFile reads file contents as UTF-8 string', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'readTextFile-test-'))
  const filePath = path.join(tempDir, 'test.txt')

  const content = 'Hello, World!'
  await writeTextFile(filePath, content)

  const actual = await readTextFile(filePath)

  assert({
    given: 'a file with text content',
    should: 'return the file contents as a string',
    actual,
    expected: content,
  })

  await rm(tempDir, { recursive: true })
})

test('readTextFile handles UTF-8 characters', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'readTextFile-test-'))
  const filePath = path.join(tempDir, 'unicode.txt')

  const content = 'Hello 世界 🌍 émojis'
  await writeTextFile(filePath, content)

  const actual = await readTextFile(filePath)

  assert({
    given: 'a file with UTF-8 characters',
    should: 'correctly read unicode content',
    actual,
    expected: content,
  })

  await rm(tempDir, { recursive: true })
})

test('readTextFile handles multiline content', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'readTextFile-test-'))
  const filePath = path.join(tempDir, 'multiline.txt')

  const content = `Line 1
Line 2
Line 3`
  await writeTextFile(filePath, content)

  const actual = await readTextFile(filePath)

  assert({
    given: 'a file with multiple lines',
    should: 'preserve line breaks',
    actual,
    expected: content,
  })

  await rm(tempDir, { recursive: true })
})

test('readTextFile throws for non-existent file', async () => {
  const filePath = '/tmp/non-existent-file-12345.txt'
  let threw = false

  try {
    await readTextFile(filePath)
  } catch {
    threw = true
  }

  assert({
    given: 'a non-existent file path',
    should: 'throw an error',
    actual: threw,
    expected: true,
  })
})
