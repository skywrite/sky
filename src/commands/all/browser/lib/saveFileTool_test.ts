import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { saveFile } from './saveFileTool.ts'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-save-file-test-'))
  const filesDir = path.join(root, 'files')
  await mkdir(filesDir)
  await writeFile(path.join(filesDir, 'Atlas-2025.pdf'), 'pdf bytes')
  await writeFile(path.join(root, 'elsewhere.pdf'), 'not yours')
  return { root, filesDir, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('save_file moves a task file into a folder, never over an existing one', async () => {
  const { root, filesDir, cleanup } = await fixture()
  try {
    const dest = path.join(root, 'Taxes', '2025')
    const first = await saveFile({ path: 'Atlas-2025.pdf', to: `${dest}/` }, { filesDir, cwd: root })
    assert({
      given: 'a file in the task folder and a folder destination',
      should: 'create the folder and move the file under its own name',
      actual: first,
      expected: { success: true, savedTo: path.join(dest, 'Atlas-2025.pdf') },
    })
    assert({
      given: 'the moved file',
      should: 'carry its bytes',
      actual: await readFile(path.join(dest, 'Atlas-2025.pdf'), 'utf8'),
      expected: 'pdf bytes',
    })
    await writeFile(path.join(filesDir, 'Atlas-2025.pdf'), 'pdf bytes')
    const again = await saveFile({ path: 'Atlas-2025.pdf', to: `${dest}/` }, { filesDir, cwd: root })
    assert({
      given: 'the very same file downloaded again, its twin already in the folder',
      should: 'report the existing path and add no copy',
      actual: { again, left: await readdir(filesDir) },
      expected: { again: { success: true, savedTo: path.join(dest, 'Atlas-2025.pdf'), alreadyThere: true }, left: [] },
    })
    await writeFile(path.join(filesDir, 'Atlas-2025.pdf'), 'second download')
    const second = await saveFile(
      { path: 'Atlas-2025.pdf', to: path.join(dest, 'Atlas-2025.pdf') },
      { filesDir, cwd: root },
    )
    assert({
      given: 'a destination name already taken',
      should: 'save beside it with a numbered suffix',
      actual: second,
      expected: { success: true, savedTo: path.join(dest, 'Atlas-2025 (2).pdf') },
    })
  } finally {
    await cleanup()
  }
})

test('save_file refuses files outside the task folder', async () => {
  const { root, filesDir, cleanup } = await fixture()
  try {
    const outside = await saveFile(
      { path: path.join(root, 'elsewhere.pdf'), to: `${root}/out/` },
      { filesDir, cwd: root },
    )
    assert({
      given: 'a source path outside the task folder',
      should: 'refuse',
      actual: outside.success,
      expected: false,
    })
    const missing = await saveFile({ path: 'nothing.pdf', to: `${root}/out/` }, { filesDir, cwd: root })
    assert({
      given: 'a source that does not exist',
      should: 'say so',
      actual: missing,
      expected: { success: false, error: `No such file: ${path.join(filesDir, 'nothing.pdf')}` },
    })
  } finally {
    await cleanup()
  }
})

test('concurrent saves to the same filename preserve both documents', async () => {
  const { root, filesDir, cleanup } = await fixture()
  try {
    await writeFile(path.join(filesDir, 'second.pdf'), 'second document')
    const to = path.join(root, 'collected', 'statement.pdf')
    const results = await Promise.all([
      saveFile({ path: 'Atlas-2025.pdf', to }, { filesDir, cwd: root }),
      saveFile({ path: 'second.pdf', to }, { filesDir, cwd: root }),
    ])
    const contents = await Promise.all(
      results.map((result) => (result.success ? readFile(result.savedTo, 'utf8') : 'failed')),
    )
    assert({
      given: 'two different documents saved to the same name concurrently',
      should: 'reserve distinct filenames without overwriting either document',
      actual: contents.sort(),
      expected: ['pdf bytes', 'second document'],
    })
  } finally {
    await cleanup()
  }
})
