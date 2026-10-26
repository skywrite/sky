import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { notebookDirs } from './notebookDirs.ts'

test('notebookDirs - adds every visible top-level folder after the named ones', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'sky-notebook-dirs-'))
  try {
    for (const name of ['people', 'field-guides', 'atlas', '.git', 'orgs']) await mkdir(path.join(base, name))
    await writeFile(path.join(base, 'README.md'), '# Notebook\n')
    const named = [path.join(base, 'orgs'), path.join(base, 'people'), path.join(base, 'projects')]

    assert({
      given: 'named folders (one not created yet), two unnamed folders, a hidden folder and a top-level file',
      should: 'keep the named folders in their order, then add the unnamed folders by name',
      actual: notebookDirs(base, named),
      expected: [...named, path.join(base, 'atlas'), path.join(base, 'field-guides')],
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('notebookDirs - a missing notebook leaves the named folders', () => {
  const named = ['/nb-missing/people', '/nb-missing/time']

  assert({
    given: 'a notebook folder that does not exist',
    should: 'return the named folders unchanged',
    actual: notebookDirs('/nb-missing', named),
    expected: named,
  })
})
