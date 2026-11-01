import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { openEditor, placeCaret, ROOT, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY_DIR = 'time/2026/W05/01-28'
const ROADMAP = `${DAY_DIR}/notes/09-15_Roadmap.md`
const OTHER = `${DAY_DIR}/notes/10-00_Other.md`
const DAY_FILE = `${DAY_DIR}/day.md`

const DAY_MD = `---
started: 09:00
---

# **2026-01-28 - Wed**

## Professional Complete

- 09:15 > Notes -> [Roadmap](notes/09-15_Roadmap.md)
- 10:00 > Notes -> [Other](notes/10-00_Other.md)
`

test(
  {
    name: 'explorer - Delete in the ⋯ menu trashes the file, turns to its folder, and Undo brings it back',
    timeout: 40000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '---\ntitle: Roadmap\n---\n\n# Roadmap\n\nShip the pricing page.\n',
        tempPrefix: 'explorer-delete-e2e-',
        file: ROADMAP,
        files: { [DAY_FILE]: DAY_MD, [OTHER]: '# Other\n' },
      },
      async ({ page, origin, file, relativePath, trash, errors }) => {
        const base = path.dirname(trash)
        const dayFile = path.join(base, DAY_FILE)
        const shots = env.get('SKY_EXPLORER_SCREENSHOTS')
        const shot = async (name: string) => {
          if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), animations: 'disabled' })
        }
        await page.setViewportSize({ width: 1280, height: 800 })
        await page.goto(`${origin}/explorer/${relativePath}`)
        await page.getByRole('heading', { name: 'Roadmap', exact: true }).waitFor()
        await page.locator('.sky-tree-row[data-active="true"]').waitFor()
        await page.getByRole('button', { name: 'More', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Delete', exact: true }).waitFor()
        await shot('explorer-delete-menu')
        const removed = page.waitForResponse(
          (response) => response.url().endsWith('/explorer/_api/remove') && response.request().method() === 'POST',
        )
        await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
        await removed
        await page.locator('.sky-doc-undo').waitFor()
        await page.locator('.sky-dir').waitFor()
        await page.locator('.sky-tree-row', { hasText: '09-15_Roadmap' }).waitFor({ state: 'detached' })
        await shot('explorer-delete-toast')

        assert({
          given: 'Delete chosen on a note the day lists',
          should:
            'turn the page to the folder with only the other note left, list the folder again in the tree, say where the note went, and take its line off the day',
          actual: {
            url: new URL(page.url()).pathname,
            folder: await page.locator('.sky-dir-row').allTextContents(),
            tree: await page.locator('.sky-tree-row[data-kind="file"]').allTextContents(),
            toast: await page.locator('.sky-undo-text').textContent(),
            trashed: await readdir(trash),
            fileGone: !existsSync(file),
            day: await readFile(dayFile, 'utf8'),
          },
          expected: {
            url: `/explorer/${DAY_DIR}/notes`,
            folder: ['10-00_Other'],
            tree: ['10-00_Other', 'day'],
            toast: 'Moved “09-15_Roadmap” to the Trash, and off Wednesday, January 28, 2026',
            trashed: ['09-15_Roadmap.md'],
            fileGone: true,
            day: DAY_MD.replace('- 09:15 > Notes -> [Roadmap](notes/09-15_Roadmap.md)\n', ''),
          },
        })

        const undone = page.waitForResponse(
          (response) => response.url().endsWith('/explorer/_api/undo') && response.request().method() === 'POST',
        )
        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        await undone
        await page.getByRole('heading', { name: 'Roadmap', exact: true }).waitFor()
        await page.locator('.sky-tree-row[data-active="true"]', { hasText: '09-15_Roadmap' }).waitFor()

        assert({
          given: 'Undo pressed while the toast still holds it',
          should:
            'open the note again where it was, with its line back on the day, the tree whole, and no browser errors',
          actual: {
            url: new URL(page.url()).pathname,
            tree: await page.locator('.sky-tree-row[data-kind="file"]').allTextContents(),
            toastGone: (await page.locator('.sky-doc-undo').count()) === 0,
            trashed: await readdir(trash),
            fileBack: existsSync(file),
            day: await readFile(dayFile, 'utf8'),
            errors,
          },
          expected: {
            url: `/explorer/${relativePath}`,
            tree: ['09-15_Roadmap', '10-00_Other', 'day'],
            toastGone: true,
            trashed: [],
            fileBack: true,
            day: DAY_MD,
            errors: [],
          },
        })
      },
    )
  },
)

for (const doneFirst of [false, true]) {
  test(
    {
      name: `explorer - Delete ${doneFirst ? 'after Done' : 'while editing'} waits for autosave and keeps the latest edits for Undo`,
      timeout: 40000,
    },
    async (t) => {
      await runWysiwygE2e(
        t,
        {
          initialMarkdown: '# Roadmap\n\nDraft.',
          tempPrefix: 'explorer-delete-editing-e2e-',
          file: ROADMAP,
          files: { [DAY_FILE]: DAY_MD, [OTHER]: '# Other\n' },
        },
        async ({ page, origin, file, trash, errors }) => {
          const started = Promise.withResolvers<void>()
          const release = Promise.withResolvers<void>()
          const saves: string[] = []
          let deletes = 0
          page.on('request', (request) => {
            if (request.url().endsWith('/explorer/_api/remove')) deletes++
          })
          await page.route('**/docs/_api/content/**', async (route) => {
            if (route.request().method() === 'PUT') {
              saves.push(route.request().postDataJSON().content as string)
              if (saves.length === 1) {
                started.resolve()
                await release.promise
              }
            }
            await route.continue()
          })
          try {
            await openEditor(page, origin, ROADMAP)
            await placeCaret(page, `${ROOT} p`, 6)
            await page.keyboard.type(' First edit.')
            await started.promise
            await page.keyboard.type(' Latest edit.')
            if (doneFirst) await page.getByRole('button', { name: 'Done', exact: true }).click()
            await page.getByRole('button', { name: 'More', exact: true }).click()
            await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
            await page.locator('.sky-main[inert]').waitFor()
            assert({
              given: 'Delete chosen while one save is in flight and newer edits are pending',
              should: 'wait before moving the file',
              actual: [deletes, existsSync(file)],
              expected: [0, true],
            })
            release.resolve()
            await page.locator('.sky-dir').waitFor()
            await page.locator('.sky-doc-undo').waitFor()
            // Longer than the save debounce: neither unmount nor a leftover timer may recreate the file.
            await page.waitForTimeout(1500)
            assert({
              given: 'the held save finishes',
              should: 'save the newer edit before deletion, then leave only its latest content in the Trash',
              actual: {
                saves: saves.length,
                latest: saves.at(-1)?.includes('First edit. Latest edit.'),
                deletes,
                gone: !existsSync(file),
                trashed: (await readFile(path.join(trash, '09-15_Roadmap.md'), 'utf8')).includes(
                  'First edit. Latest edit.',
                ),
              },
              expected: { saves: 2, latest: true, deletes: 1, gone: true, trashed: true },
            })
            await page.getByRole('button', { name: 'Undo', exact: true }).click()
            await page.getByRole('heading', { name: 'Roadmap', exact: true }).waitFor()
            assert({
              given: 'Undo after deleting from edit mode',
              should: 'restore the latest edits and the day link without browser errors',
              actual: [
                (await readFile(file, 'utf8')).includes('First edit. Latest edit.'),
                await readFile(path.join(path.dirname(trash), DAY_FILE), 'utf8'),
                errors,
              ],
              expected: [true, DAY_MD, []],
            })
          } finally {
            release.resolve()
          }
        },
      )
    },
  )
}

test(
  { name: 'explorer - a failed pending save keeps the editor and allows Delete to be retried', timeout: 40000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Roadmap\n\nDraft.',
        tempPrefix: 'explorer-delete-save-failure-e2e-',
        file: ROADMAP,
        files: { [DAY_FILE]: DAY_MD, [OTHER]: '# Other\n' },
      },
      async ({ page, origin, file }) => {
        let failSave = true
        let deletes = 0
        page.on('request', (request) => {
          if (request.url().endsWith('/explorer/_api/remove')) deletes++
        })
        await page.route('**/docs/_api/content/**', (route) =>
          route.request().method() === 'PUT' && failSave
            ? route.fulfill({ status: 503, json: { message: 'Temporary save failure' } })
            : route.continue(),
        )
        await openEditor(page, origin, ROADMAP)
        await placeCaret(page, `${ROOT} p`, 6)
        await page.keyboard.type(' Keep these edits.')
        await page.getByRole('button', { name: 'More', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
        await page.locator('.sky-doc-undo[data-failed="true"]').waitFor()
        assert({
          given: 'the pending edit cannot be saved before deleting',
          should: 'identify the file, explain how to retry, and keep its unsaved editor content without deleting',
          actual: [
            deletes,
            existsSync(file),
            await page.locator(ROOT).textContent(),
            await page.locator('.sky-undo-text').textContent(),
          ],
          expected: [
            0,
            true,
            'RoadmapDraft. Keep these edits.',
            'Could not delete “09-15_Roadmap.md”. Your latest edits could not be saved. Try Delete again once they are saved.',
          ],
        })
        failSave = false
        await page.getByRole('button', { name: 'More', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
        await page.locator('.sky-dir').waitFor()
        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        await page.getByRole('heading', { name: 'Roadmap', exact: true }).waitFor()
        assert({
          given: 'saving works on the next Delete',
          should: 'delete once and recover all edits with Undo',
          actual: [deletes, (await readFile(file, 'utf8')).includes('Keep these edits.')],
          expected: [1, true],
        })
      },
    )
  },
)

test(
  { name: 'meeting - Delete is in its own menu and Undo returns from the day to the meeting', timeout: 40000 },
  async (t) => {
    const slug = '09-15_Atlas-Review'
    const meeting = `${DAY_DIR}/actions/meetings/${slug}.md`
    const href = `/2026-01-28/meetings/${slug}`
    const markdown =
      '---\nsummary: Atlas review\nwhen: 2026-01-28 09:15 - 09:45\nmedium: Zoom\n---\n\n# Atlas review\n\n## Summary\n\nReview the launch plan.\n'
    const day = DAY_MD.replace('[Roadmap](notes/09-15_Roadmap.md)', `[Atlas review](actions/meetings/${slug}.md)`)
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: markdown,
        tempPrefix: 'meeting-delete-e2e-',
        file: meeting,
        files: { [DAY_FILE]: day, [OTHER]: '# Other\n' },
        store: true,
        day: true,
      },
      async ({ page, origin, file, trash, errors }) => {
        await page.goto(`${origin}${href}`)
        await page.getByRole('heading', { name: 'Atlas review', exact: true }).waitFor()
        assert({
          given: 'a direct meeting page load',
          should: 'name the meeting in the browser title',
          actual: await page.title(),
          expected: 'sky · Atlas review',
        })
        await page.getByRole('button', { name: 'More', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
        await page.waitForURL(`${origin}/2026-01-28`)
        await page.getByRole('button', { name: 'Undo', exact: true }).waitFor()
        assert({
          given: 'Delete chosen directly on the meeting page',
          should: 'return to its day with Undo still available, the meeting in the Trash, and its day link removed',
          actual: [
            !existsSync(file),
            await readdir(trash),
            (await readFile(path.join(path.dirname(trash), DAY_FILE), 'utf8')).includes(slug),
          ],
          expected: [true, [`${slug}.md`], false],
        })
        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        await page.waitForURL(`${origin}${href}`)
        await page.getByRole('heading', { name: 'Atlas review', exact: true }).waitFor()
        await page.goBack()
        await page.waitForURL(`${origin}/2026-01-28`)
        await page.goForward()
        await page.getByRole('heading', { name: 'Atlas review', exact: true }).waitFor()
        assert({
          given: 'Undo, then browser back and forward',
          should: 'restore the meeting and day link, reopen its own page, and keep its browser title',
          actual: [
            await readFile(file, 'utf8'),
            await readFile(path.join(path.dirname(trash), DAY_FILE), 'utf8'),
            await readdir(trash),
            await page.title(),
            errors,
          ],
          expected: [markdown, day, [], 'sky · Atlas review', []],
        })
        await writeFile(file, markdown.replaceAll('Atlas review', 'Atlas planning'))
        await page.getByRole('heading', { name: 'Atlas planning', exact: true }).waitFor()
        assert({
          given: 'the meeting title changes on disk while its page is open',
          should: 'update the browser title on the background refresh',
          actual: await page.title(),
          expected: 'sky · Atlas planning',
        })
      },
    )
  },
)
