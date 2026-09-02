import { mkdir, utimes, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { type FileFacts, locateFile, whereWord } from './locateFile.ts'

const MODIFIED = new Date('2026-03-05T14:22:31.575Z')

/** A folder holding `name` with the bytes given, stamped with the fixed modified time. */
async function folderWith(prefix: string, name: string, bytes: string): Promise<string> {
  const dir = await makeTempDir({ prefix })
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await writeFile(file, bytes)
  await utimes(file, MODIFIED, MODIFIED)
  return dir
}

const facts = (name: string, size: number): FileFacts => ({ name, size, lastModified: MODIFIED.getTime() })

test({ name: 'locateFile - name, size and modified time find the original in a search folder' }, async () => {
  const desktop = await folderWith('sky-locate-desktop-', 'report.pdf', 'twelve bytes')
  const downloads = await folderWith('sky-locate-downloads-', 'other.pdf', 'twelve bytes')
  const found = await locateFile(facts('report.pdf', 12), { searchDirs: [desktop, downloads] })
  assert({
    given: 'the file on the desktop, and the facts a drop carries',
    should: 'find that one file, and say which folder holds it',
    actual: found.map((f) => [f.path, f.where]),
    expected: [[path.join(desktop, 'report.pdf'), path.basename(desktop)]],
  })
})

test({ name: 'locateFile - a namesake with different bytes or a different time is not the file' }, async () => {
  const desktop = await folderWith('sky-locate-desktop-', 'report.pdf', 'twelve bytes')
  const downloads = await folderWith('sky-locate-downloads-', 'report.pdf', 'a longer file than that')
  const older = await folderWith('sky-locate-older-', 'report.pdf', 'twelve bytes')
  await utimes(path.join(older, 'report.pdf'), new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
  const found = await locateFile(facts('report.pdf', 12), { searchDirs: [downloads, older, desktop] })
  assert({
    given: 'three files of that name: one longer, one older, one right',
    should: 'return only the one whose size and modified time both match',
    actual: found.map((f) => f.path),
    expected: [path.join(desktop, 'report.pdf')],
  })
})

test(
  { name: 'locateFile - a Finder duplicate keeps the modified time, so both come back in folder order' },
  async () => {
    const desktop = await folderWith('sky-locate-desktop-', 'report.pdf', 'twelve bytes')
    const downloads = await folderWith('sky-locate-downloads-', 'report.pdf', 'twelve bytes')
    const found = await locateFile(facts('report.pdf', 12), { searchDirs: [desktop, downloads] })
    assert({
      given: 'the same file in two search folders',
      should: 'list both, the first search folder first',
      actual: found.map((f) => f.path),
      expected: [path.join(desktop, 'report.pdf'), path.join(downloads, 'report.pdf')],
    })
  },
)

test({ name: 'locateFile - nothing on disk means an empty answer, not an error' }, async () => {
  const desktop = await folderWith('sky-locate-desktop-', 'report.pdf', 'twelve bytes')
  const found = await locateFile(facts('mail-attachment.pdf', 12), { searchDirs: [desktop, '/nonexistent/folder'] })
  assert({ given: 'a name no search folder holds', should: 'find nothing', actual: found, expected: [] })
})

test({ name: 'whereWord - the folder as a person names it' }, () => {
  assert({
    given: 'a file on the desktop',
    should: 'say Desktop',
    actual: whereWord('/Users/jane/Desktop/report.pdf', '/Users/jane'),
    expected: 'Desktop',
  })
  assert({
    given: 'a file loose in the home directory',
    should: 'say home folder',
    actual: whereWord('/Users/jane/report.pdf', '/Users/jane'),
    expected: 'home folder',
  })
})
