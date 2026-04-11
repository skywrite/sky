import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - enter on an empty list item exits list item safely', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-empty-list-enter-',
      initialMarkdown: '- keep\n- \n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await page.click('.editable-block-preview li:nth-of-type(2)')
      await page.keyboard.press('Home')
      await page.keyboard.press('Enter')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'enter on an empty list item',
        should: 'exit the list item without preserving the markdown list marker',
        actual: disk,
        expected: '- keep\n',
      })
    },
  )
})
