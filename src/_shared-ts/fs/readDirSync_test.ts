import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import readDirSync, { type DirEntry } from './readDirSync.ts'

test('readDirSync iterates over directory entries', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'readDirSync-test-'))
  writeFileSync(path.join(tempDir, 'file1.txt'), 'content1')
  writeFileSync(path.join(tempDir, 'file2.txt'), 'content2')

  const entries: DirEntry[] = []
  for (const entry of readDirSync(tempDir)) {
    entries.push(entry)
  }

  assert({
    given: 'a directory with two files',
    should: 'iterate over both entries',
    actual: entries.length,
    expected: 2,
  })

  rmSync(tempDir, { recursive: true })
})

test('readDirSync entry has correct isFile property', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'readDirSync-test-'))
  writeFileSync(path.join(tempDir, 'test.txt'), 'content')

  let fileEntry
  for (const entry of readDirSync(tempDir)) {
    if (entry.name === 'test.txt') fileEntry = entry
  }

  assert({
    given: 'a file in the directory',
    should: 'have isFile true',
    actual: fileEntry?.isFile,
    expected: true,
  })

  assert({
    given: 'a file in the directory',
    should: 'have isDirectory false',
    actual: fileEntry?.isDirectory,
    expected: false,
  })

  rmSync(tempDir, { recursive: true })
})

test('readDirSync entry has correct isDirectory property', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'readDirSync-test-'))
  mkdirSync(path.join(tempDir, 'subdir'))

  let dirEntry
  for (const entry of readDirSync(tempDir)) {
    if (entry.name === 'subdir') dirEntry = entry
  }

  assert({
    given: 'a subdirectory',
    should: 'have isDirectory true',
    actual: dirEntry?.isDirectory,
    expected: true,
  })

  assert({
    given: 'a subdirectory',
    should: 'have isFile false',
    actual: dirEntry?.isFile,
    expected: false,
  })

  rmSync(tempDir, { recursive: true })
})

test('readDirSync returns empty for empty directory', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'readDirSync-test-'))

  const entries: DirEntry[] = []
  for (const entry of readDirSync(tempDir)) {
    entries.push(entry)
  }

  assert({
    given: 'an empty directory',
    should: 'return no entries',
    actual: entries.length,
    expected: 0,
  })

  rmSync(tempDir, { recursive: true })
})
