import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

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
