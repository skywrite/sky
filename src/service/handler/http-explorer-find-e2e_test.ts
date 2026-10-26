import { assert, test } from '#test'
import {
  openEditor,
  readMarkdownFromDisk,
  ROOT,
  runWysiwygE2e,
  waitForAutosave,
  waitForSettle,
} from './httpWysiwygE2eTestHelpers.ts'

const MARKDOWN = `# Atlas launch plan

The Atlas launch moves to March 9, and Sam writes the press note for Atlas.

- [ ] Point the signup page at [atlas.example.com](https://atlas.example.com)

Does **Atlas** need a second review?
`

const COUNT = '.sky-findbox-count'

test(
  {
    name: 'explorer - find and replace: one match, then the rest as one undo step, links left working',
    timeout: 40000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'explorer-find-e2e-', initialMarkdown: MARKDOWN },
      async ({ page, origin, file, errors }) => {
        await openEditor(page, origin)
        await page.keyboard.press('Meta+f')
        await page.getByRole('textbox', { name: 'Find in this file' }).fill('Atlas')
        await waitForSettle(page)
        const anyCase = await page.locator(COUNT).textContent()
        await page.getByRole('button', { name: 'Match case' }).click()
        await waitForSettle(page)
        const exactCase = await page.locator(COUNT).textContent()

        await page.getByRole('button', { name: 'Show replace' }).click()
        await page.getByRole('textbox', { name: 'Replace with' }).fill('Orion')
        await page.keyboard.press('Enter')
        await waitForSettle(page)
        const afterOne = await page.locator(COUNT).textContent()

        await page.getByRole('button', { name: 'Replace all', exact: true }).click()
        await page.locator('.sky-doc-undo').waitFor()
        const toast = await page.locator('.sky-undo-text').textContent()
        await waitForAutosave(page)

        assert({
          given: '"Atlas" four times as written, once more as a link in lower case, and Match case on',
          should:
            'count the link only while the case is free, replace the current match, then the rest at once — keeping the bold and the link’s address',
          actual: {
            anyCase,
            exactCase,
            afterOne,
            toast,
            left: await page.locator(COUNT).textContent(),
            saved: await readMarkdownFromDisk(file),
          },
          expected: {
            anyCase: '1 of 5',
            exactCase: '1 of 4',
            afterOne: '1 of 3',
            toast: 'Replaced “Atlas” with “Orion” in 3 places',
            left: 'No matches',
            saved: MARKDOWN.replaceAll('Atlas', 'Orion'),
          },
        })

        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        await waitForAutosave(page)

        assert({
          given: 'Undo in the toast',
          should: 'put back the three words Replace all changed, keep the first replace, and raise no browser errors',
          actual: { saved: await readMarkdownFromDisk(file), errors },
          expected: { saved: MARKDOWN.replace('Atlas', 'Orion'), errors: [] },
        })
      },
    )
  },
)

test(
  {
    name: 'explorer - find while reading: asking for Replace opens the editor, Esc leaves the match selected',
    timeout: 40000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'explorer-find-read-e2e-', initialMarkdown: MARKDOWN },
      async ({ page, origin, errors }) => {
        await page.goto(`${origin}/explorer/notes/preview.md`)
        await page.getByRole('heading', { name: 'Atlas launch plan' }).waitFor()
        await page.getByRole('button', { name: 'More', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Find and replace…' }).click()
        await page.getByRole('textbox', { name: 'Find in this file' }).fill('press note')
        await waitForSettle(page)
        const reading = await page.locator(COUNT).textContent()
        const editingBefore = await page.locator(ROOT).count()

        await page.getByRole('button', { name: 'Show replace' }).click()
        await page.locator(ROOT).waitFor()
        await page.getByRole('textbox', { name: 'Replace with' }).waitFor()
        await waitForSettle(page)
        const editing = await page.locator(COUNT).textContent()
        await page.getByRole('textbox', { name: 'Find in this file' }).press('Escape')

        assert({
          given: 'the ⋯ menu’s Find and replace while reading, then Show replace, then Esc',
          should: 'find in the rendered page, switch to the editor, find there too, and leave the match selected in it',
          actual: {
            reading,
            editingBefore,
            editing,
            open: await page.locator('.sky-findbox').count(),
            selected: await page.evaluate(() => document.getSelection()?.toString()),
            inEditor: await page.evaluate(
              () => document.getSelection()?.anchorNode?.parentElement?.closest('.sky-wysiwyg') !== null,
            ),
            errors,
          },
          expected: {
            reading: '1 of 1',
            editingBefore: 0,
            editing: '1 of 1',
            open: 0,
            selected: 'press note',
            inEditor: true,
            errors: [],
          },
        })
      },
    )
  },
)
