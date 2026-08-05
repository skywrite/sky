import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import readDir, { type DirEntry } from './readDir.ts'

test('readDir iterates over directory entries', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'readDir-test-'))
  await writeFile(path.join(tempDir, 'file1.txt'), 'content1')
  await writeFile(path.join(tempDir, 'file2.txt'), 'content2')

  const entries: DirEntry[] = []
  for await (const entry of readDir(tempDir)) {
    entries.push(entry)
  }

  assert({
    given: 'a directory with two files',
    should: 'iterate over both entries',
    actual: entries.length,
    expected: 2,
  })

  await rm(tempDir, { recursive: true })
})

test('readDir entry has correct isFile property', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'readDir-test-'))
  await writeFile(path.join(tempDir, 'test.txt'), 'content')

  let fileEntry
  for await (const entry of readDir(tempDir)) {
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

  await rm(tempDir, { recursive: true })
})

test('readDir entry has correct isDirectory property', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'readDir-test-'))
  await mkdir(path.join(tempDir, 'subdir'))

  let dirEntry
  for await (const entry of readDir(tempDir)) {
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

  await rm(tempDir, { recursive: true })
})

test('readDir returns empty for empty directory', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'readDir-test-'))

  const entries: DirEntry[] = []
  for await (const entry of readDir(tempDir)) {
    entries.push(entry)
  }

  assert({
    given: 'an empty directory',
    should: 'return no entries',
    actual: entries.length,
    expected: 0,
  })

  await rm(tempDir, { recursive: true })
})
