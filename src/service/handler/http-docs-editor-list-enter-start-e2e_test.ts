import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - enter at list item start inserts an item above', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-list-enter-start-',
      initialMarkdown: '- alpha\n- beta\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await page.click('.editable-block-preview li:nth-of-type(1)')
      await page.keyboard.press('Home')
      await page.keyboard.press('Enter')
      await page.keyboard.type('top')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'enter at start of first list item',
        should: 'create a new list item above and keep existing items in order',
        actual: disk,
        expected: '- top\n- alpha\n- beta\n',
      })
    },
  )
})
