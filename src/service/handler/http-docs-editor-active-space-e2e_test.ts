import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - active visual block accepts space typing', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-space-',
      initialMarkdown: 'alpha\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await page.keyboard.press('End')
      await page.keyboard.type(' beta')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'an active visual block',
        should: 'persist inserted space characters after autosave',
        actual: disk,
        expected: 'alpha beta\n',
      })
    },
  )
})
