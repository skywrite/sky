import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - enter splits a paragraph into two markdown blocks', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-enter-split-',
      initialMarkdown: 'alpha beta\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await page.keyboard.press('Home')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('Enter')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'enter inside a paragraph',
        should: 'persist as two markdown paragraphs',
        actual: disk,
        expected: 'alpha\n\n beta\n',
      })
    },
  )
})
