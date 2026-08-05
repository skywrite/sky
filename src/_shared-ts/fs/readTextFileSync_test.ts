import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import readTextFileSync from './readTextFileSync.ts'

test('readTextFileSync reads a simple text file', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'readTextFileSync-test-'))
  const filePath = path.join(tempDir, 'test.txt')

  writeFileSync(filePath, 'hello world', 'utf-8')

  const actual = readTextFileSync(filePath)

  assert({
    given: 'a simple text file',
    should: 'return the file contents',
    actual,
    expected: 'hello world',
  })

  rmSync(tempDir, { recursive: true })
})

test('readTextFileSync reads multiline content', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'readTextFileSync-test-'))
  const filePath = path.join(tempDir, 'multiline.txt')
  const content = 'line 1\nline 2\nline 3'

  writeFileSync(filePath, content, 'utf-8')

  const actual = readTextFileSync(filePath)

  assert({
    given: 'a file with multiple lines',
    should: 'preserve line endings',
    actual,
    expected: content,
  })

  rmSync(tempDir, { recursive: true })
})

test('readTextFileSync reads UTF-8 content with special characters', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'readTextFileSync-test-'))
  const filePath = path.join(tempDir, 'utf8.txt')
  const content = 'Hello 世界 🌍 αβγ'

  writeFileSync(filePath, content, 'utf-8')

  const actual = readTextFileSync(filePath)

  assert({
    given: 'a file with UTF-8 special characters',
    should: 'correctly decode the content',
    actual,
    expected: content,
  })

  rmSync(tempDir, { recursive: true })
})

test('readTextFileSync throws for non-existent file', () => {
  const filePath = '/tmp/non-existent-file-xyz123.txt'
  let threw = false

  try {
    readTextFileSync(filePath)
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

test('readTextFileSync reads empty file', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'readTextFileSync-test-'))
  const filePath = path.join(tempDir, 'empty.txt')

  writeFileSync(filePath, '', 'utf-8')

  const actual = readTextFileSync(filePath)

  assert({
    given: 'an empty file',
    should: 'return empty string',
    actual,
    expected: '',
  })

  rmSync(tempDir, { recursive: true })
})
