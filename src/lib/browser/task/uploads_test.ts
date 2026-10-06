import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { prepareBrowserUploads } from './uploads.ts'

test('upload staging pins concrete files and refuses symbolic links or ambiguous destinations', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-upload-test-'))
  try {
    const file = path.join(root, 'example.pdf')
    await writeFile(file, '%PDF-1.4 synthetic example')
    const task = path.join(root, 'task')
    await mkdir(task)
    const staged = await prepareBrowserUploads([file], 'https://atlas.example', task)
    await writeFile(file, 'changed original')
    const link = path.join(root, 'link.pdf')
    await symlink(file, link)
    let symlinkRefused = false
    let destinationRefused = false
    try {
      await prepareBrowserUploads([link], 'https://atlas.example', path.join(root, 'link-task'))
    } catch {
      symlinkRefused = true
    }
    try {
      await prepareBrowserUploads([file], 'https://atlas.example/other', task)
    } catch {
      destinationRefused = true
    }
    assert({
      given: 'authorized files copied before the browser opens',
      should: 'retain their bytes and reject symbolic links and non-origin URLs',
      actual: [await readFile(staged.files[0]!.path, 'utf8'), staged.origin, symlinkRefused, destinationRefused],
      expected: ['%PDF-1.4 synthetic example', 'https://atlas.example', true, true],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
