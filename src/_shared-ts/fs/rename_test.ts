import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import exists from './exists.ts'
import rename from './rename.ts'

test('rename moves a file to a new name', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'rename-test-'))
  const oldPath = path.join(tempDir, 'old.txt')
  const newPath = path.join(tempDir, 'new.txt')

  await writeFile(oldPath, 'hello', 'utf-8')

  await rename(oldPath, newPath)

  assert({
    given: 'renaming a file',
    should: 'file exists at new path',
    actual: await exists(newPath),
    expected: true,
  })

  assert({
    given: 'renaming a file',
    should: 'file no longer exists at old path',
    actual: await exists(oldPath),
    expected: false,
  })

  await rm(tempDir, { recursive: true })
})

test('rename moves a file to a different directory', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'rename-test-'))
  const subDir = path.join(tempDir, 'subdir')
  const oldPath = path.join(tempDir, 'file.txt')
  const newPath = path.join(subDir, 'file.txt')

  await writeFile(oldPath, 'content', 'utf-8')
  await mkdir(subDir)

  await rename(oldPath, newPath)

  assert({
    given: 'moving a file to a subdirectory',
    should: 'file exists at new location',
    actual: await exists(newPath),
    expected: true,
  })

  await rm(tempDir, { recursive: true })
})

test('rename throws for non-existent source', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'rename-test-'))
  const oldPath = path.join(tempDir, 'nonexistent.txt')
  const newPath = path.join(tempDir, 'new.txt')

  let threw = false
  try {
    await rename(oldPath, newPath)
  } catch {
    threw = true
  }

  assert({
    given: 'renaming a non-existent file',
    should: 'throw an error',
    actual: threw,
    expected: true,
  })

  await rm(tempDir, { recursive: true })
})
