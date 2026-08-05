import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { assert, test } from '#test'
import makeTempDir from './makeTempDir.ts'
import outputFile from './outputFile.ts'
import walk, { type WalkEntry } from './walk.ts'

test('walk', async () => {
  const fixtures: {
    given: string
    should: string
    structure: Record<string, string>
    options?: { includeDirs?: boolean; exts?: string[]; maxDepth?: number }
    expectedPaths: string[]
  }[] = [
    {
      given: 'a directory with files',
      should: 'yield all files and directories',
      structure: {
        'file1.txt': 'content1',
        'file2.md': 'content2',
        'subdir/file3.txt': 'content3',
      },
      expectedPaths: ['file1.txt', 'file2.md', 'subdir', 'subdir/file3.txt'],
    },
    {
      given: 'includeDirs: false',
      should: 'only yield files',
      structure: {
        'file1.txt': 'content1',
        'subdir/file2.txt': 'content2',
      },
      options: { includeDirs: false },
      expectedPaths: ['file1.txt', 'subdir/file2.txt'],
    },
    {
      given: 'exts filter',
      should: 'only yield files with matching extensions',
      structure: {
        'file1.txt': 'content1',
        'file2.md': 'content2',
        'file3.ts': 'content3',
      },
      options: { exts: ['.md', '.ts'] },
      expectedPaths: ['file2.md', 'file3.ts'],
    },
    {
      given: 'maxDepth: 1',
      should: 'only yield entries up to depth 1 (no nested file)',
      structure: {
        'file1.txt': 'content1',
        'subdir/file2.txt': 'content2',
        'subdir/nested/file3.txt': 'content3',
      },
      options: { maxDepth: 1 },
      expectedPaths: ['file1.txt', 'subdir', 'subdir/file2.txt', 'subdir/nested'],
    },
  ]

  for (const fixture of fixtures) {
    const { given, should, structure, options, expectedPaths } = fixture
    const tmpDir = await makeTempDir({ prefix: 'walk-test-' })

    try {
      // Create the file structure
      for (const [relativePath, content] of Object.entries(structure)) {
        const fullPath = path.join(tmpDir, relativePath)
        await outputFile(fullPath, content)
      }

      // Collect walk results
      const entries: WalkEntry[] = []
      for await (const entry of walk(tmpDir, options)) {
        entries.push(entry)
      }

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

test('walk entry properties', async () => {
  const tmpDir = await makeTempDir({ prefix: 'walk-entry-test-' })

  try {
    // Create a file and a directory
    await outputFile(path.join(tmpDir, 'file.txt'), 'content')
    await outputFile(path.join(tmpDir, 'subdir/nested.txt'), 'nested content')

    const entries: WalkEntry[] = []
    for await (const entry of walk(tmpDir)) {
      entries.push(entry)
    }

    // Find the file entry
    const fileEntry = entries.find((e) => e.name === 'file.txt')
    assert({
      given: 'a file entry',
      should: 'have isFile: true',
      actual: fileEntry?.isFile,
      expected: true,
    })
    assert({
      given: 'a file entry',
      should: 'have isDirectory: false',
      actual: fileEntry?.isDirectory,
      expected: false,
    })

    // Find the directory entry
    const dirEntry = entries.find((e) => e.name === 'subdir')
    assert({
      given: 'a directory entry',
      should: 'have isDirectory: true',
      actual: dirEntry?.isDirectory,
      expected: true,
    })
    assert({
      given: 'a directory entry',
      should: 'have isFile: false',
      actual: dirEntry?.isFile,
      expected: false,
    })
  } finally {
    await rm(tmpDir, { recursive: true })
  }
})
