import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

/** Where a request lands: the redirect's location, or the status when it is no redirect. */
async function landing(app: ReturnType<typeof createTestHttpApp>, url: string): Promise<string> {
  const response = await app.request(`http://localhost${url}`, { redirect: 'manual' })
  return response.status === 302 ? (response.headers.get('location') ?? '') : String(response.status)
}

test({ name: 'docs route - the file pages of old redirect into the explorer' }, async () => {
  const testDir = await mkdtemp(path.join(os.tmpdir(), 'http-docs-redirect-'))
  const notesDir = path.join(testDir, 'notes')
  await mkdir(notesDir, { recursive: true })
  await writeFile(path.join(notesDir, 'foo.md'), '# Foo\n')

  try {
    const app = createTestHttpApp([notesDir])
    const landings = await Promise.all(
      [
        '/docs',
        '/docs/',
        '/docs?file=notes/foo.md&theme=night',
        '/docs/notes/foo.md?mode=edit',
        '/docs/notes/a%20b/c%26d.md',
        '/markdown/view?file=notes/foo.md',
        '/markdown/view/notes/foo.md?theme=night',
      ].map((url) => landing(app, url)),
    )

    assert({
      given:
        'every form a file page once took — bare, by query, by path, the legacy /markdown/view — with its theme or mode',
      should: 'redirect to the explorer page for that path, the path re-encoded and the options dropped',
      actual: landings,
      expected: [
        '/explorer',
        '/explorer',
        '/explorer/notes/foo.md',
        '/explorer/notes/foo.md',
        '/explorer/notes/a%20b/c%26d.md',
        '/explorer/notes/foo.md',
        '/explorer/notes/foo.md',
      ],
    })

    const meta = await app.request('http://localhost/docs/_api/content/notes/foo.md?meta=1')
    assert({
      given: "the file's data API under /docs/_api",
      should: 'still answer in place — the explorer and the editor read and save through it',
      actual: [meta.status, ((await meta.json()) as { relativePath: string }).relativePath],
      expected: [200, 'notes/foo.md'],
    })
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})
