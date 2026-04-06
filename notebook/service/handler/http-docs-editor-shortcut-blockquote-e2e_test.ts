import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  clearActiveBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - blockquote shortcut promotes paragraph into quote', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-shortcut-quote-',
      initialMarkdown: 'placeholder\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await clearActiveBlock(page)
      await page.keyboard.type('>')
      await page.keyboard.press('Space')
      await page.keyboard.type('Quoted')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'typing > + space at paragraph start',
        should: 'persist as a markdown blockquote line',
        actual: disk,
        expected: '> Quoted\n',
      })
    },
  )
})
