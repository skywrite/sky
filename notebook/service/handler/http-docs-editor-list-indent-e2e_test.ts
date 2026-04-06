import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - tab and shift-tab indent and outdent list items', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-list-indent-',
      initialMarkdown: '- parent\n- child\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await page.click('.editable-block-preview li:nth-of-type(2)')
      await page.keyboard.press('Home')
      await page.keyboard.press('Tab')
      await waitForAutosave(page)

      const afterIndent = await readMarkdownFromDisk(previewFile)
      assert({
        given: 'tab on the second list item',
        should: 'indent the item into a nested list',
        actual: afterIndent,
        expected: '- parent\n  - child\n',
      })

      await page.click('.editable-block-preview li li')
      await page.keyboard.press('Home')
      await page.keyboard.press('Shift+Tab')
      await waitForAutosave(page)

      const afterOutdent = await readMarkdownFromDisk(previewFile)
      assert({
        given: 'shift-tab on a nested list item',
        should: 'outdent it back to the parent list level',
        actual: afterOutdent,
        expected: '- parent\n- child\n',
      })
    },
  )
})
