import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - backspace at heading start demotes to paragraph', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-heading-backspace-',
      initialMarkdown: '# Demo Heading\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await page.keyboard.press('Home')
      await page.keyboard.press('Backspace')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'caret at start of active heading block',
        should: 'demote heading to paragraph markdown on backspace',
        actual: disk,
        expected: 'Demo Heading\n',
      })
    },
  )
})
