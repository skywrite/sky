import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  clearActiveBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - bullet shortcut promotes paragraph into list', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-shortcut-bullet-',
      initialMarkdown: 'placeholder\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await clearActiveBlock(page)
      await page.keyboard.type('-')
      await page.keyboard.press('Space')
      await page.keyboard.type('Item')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'typing - + space at paragraph start',
        should: 'persist as a markdown bullet list item',
        actual: disk,
        expected: '- Item\n',
      })
    },
  )
})
