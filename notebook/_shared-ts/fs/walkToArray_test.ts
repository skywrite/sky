import { assert, test } from '#test'
import * as path from 'node:path'
import makeTempDir from './makeTempDir.ts'
import outputFile from './outputFile.ts'
import walkToArray from './walkToArray.ts'
import { rm } from 'node:fs/promises'

test('walkToArray', async () => {
  const fixtures: {
    given: string
    should: string
    structure: Record<string, string>
    options?: { includeDirs?: boolean; exts?: string[] }
    expectedPaths: string[]
  }[] = [
    {
      given: 'a directory with files',
      should: 'return array of file entries (no dirs by default)',
      structure: {
        'file1.txt': 'content1',
        'file2.md': 'content2',
        'subdir/file3.txt': 'content3',
      },
      expectedPaths: ['file1.txt', 'file2.md', 'subdir/file3.txt'],
    },
    {
      given: 'exts filter',
      should: 'only return files with matching extensions',
      structure: {
        'file1.txt': 'content1',
        'file2.md': 'content2',
        'file3.ts': 'content3',
      },
      options: { exts: ['.md'] },
      expectedPaths: ['file2.md'],
    },
    {
      given: 'includeDirs: true',
      should: 'include directories in result',
      structure: {
        'file1.txt': 'content1',
        'subdir/file2.txt': 'content2',
      },
      options: { includeDirs: true },
      expectedPaths: ['file1.txt', 'subdir', 'subdir/file2.txt'],
    },
  ]

  for (const fixture of fixtures) {
    const { given, should, structure, options, expectedPaths } = fixture
    const tmpDir = await makeTempDir({ prefix: 'walkToArray-test-' })

    try {
      // Create the file structure
      for (const [relativePath, content] of Object.entries(structure)) {
        const fullPath = path.join(tmpDir, relativePath)
        await outputFile(fullPath, content)
      }

      // Get walkToArray results
      const entries = await walkToArray(tmpDir, options)

      // Get relative paths and sort for comparison
      const relativePaths = entries.map((e) => path.relative(tmpDir, e.path)).sort()

      assert({
        given,
        should,
        actual: relativePaths,
        expected: expectedPaths.sort(),
      })
    } finally {
      await rm(tmpDir, { recursive: true })
    }
  }
})

test('walkToArray with multiple directories', async () => {
  const tmpDir1 = await makeTempDir({ prefix: 'walkToArray-multi1-' })
  const tmpDir2 = await makeTempDir({ prefix: 'walkToArray-multi2-' })

  try {
    await outputFile(path.join(tmpDir1, 'file1.txt'), 'content1')
    await outputFile(path.join(tmpDir2, 'file2.txt'), 'content2')

    const entries = await walkToArray([tmpDir1, tmpDir2])

    assert({
      given: 'multiple directories',
      should: 'return files from all directories',
      actual: entries.length,
      expected: 2,
    })

    const names = entries.map((e) => e.name).sort()
    assert({
      given: 'multiple directories',
      should: 'include files from both',
      actual: names,
      expected: ['file1.txt', 'file2.txt'],
    })
  } finally {
    await rm(tmpDir1, { recursive: true })
    await rm(tmpDir2, { recursive: true })
  }
})
