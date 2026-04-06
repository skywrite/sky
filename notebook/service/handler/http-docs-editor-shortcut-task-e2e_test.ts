import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  clearActiveBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - task shortcut promotes paragraph into task list item', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-shortcut-task-',
      initialMarkdown: 'placeholder\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await clearActiveBlock(page)
      await page.keyboard.type('[ ]')
      await page.keyboard.press('Space')
      await page.keyboard.type('Task')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'typing [ ] + space at paragraph start',
        should: 'persist as an unchecked markdown task list item',
        actual: disk,
        expected: '- [ ] Task\n',
      })
    },
  )
})
