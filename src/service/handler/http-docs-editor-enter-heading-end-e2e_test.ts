import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - enter at heading end inserts paragraph after heading', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-enter-heading-end-',
      initialMarkdown: '# Demo\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('After')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'enter at the end of an active heading block',
        should: 'insert a new paragraph below and place typing there',
        actual: disk,
        expected: '# Demo\n\nAfter\n',
      })
    },
  )
})
