import { rm, stat } from 'node:fs/promises'
import { assert, test } from '#test'
import makeTempDir from './makeTempDir.ts'

test('makeTempDir creates a temporary directory', async () => {
  const tempDir = await makeTempDir()

  const stats = await stat(tempDir)

  assert({
    given: 'calling makeTempDir',
    should: 'create a directory',
    actual: stats.isDirectory(),
    expected: true,
  })

  await rm(tempDir, { recursive: true })
})

test('makeTempDir uses default prefix', async () => {
  const tempDir = await makeTempDir()
  const dirName = tempDir.split('/').pop() || ''

  assert({
    given: 'no prefix option',
    should: 'use default tmp- prefix',
    actual: dirName.startsWith('tmp-'),
    expected: true,
  })

  await rm(tempDir, { recursive: true })
})

test('makeTempDir uses custom prefix', async () => {
  const tempDir = await makeTempDir({ prefix: 'mytest-' })
  const dirName = tempDir.split('/').pop() || ''

  assert({
    given: 'a custom prefix option',
    should: 'use that prefix',
    actual: dirName.startsWith('mytest-'),
    expected: true,
  })

  await rm(tempDir, { recursive: true })
})

test('makeTempDir creates unique directories', async () => {
  const tempDir1 = await makeTempDir({ prefix: 'unique-' })
  const tempDir2 = await makeTempDir({ prefix: 'unique-' })

  assert({
    given: 'two calls to makeTempDir',
    should: 'create different directories',
    actual: tempDir1 !== tempDir2,
    expected: true,
  })

  await rm(tempDir1, { recursive: true })
  await rm(tempDir2, { recursive: true })
})
