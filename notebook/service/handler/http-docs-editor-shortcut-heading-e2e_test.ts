import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  clearActiveBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - heading markdown shortcut promotes paragraph on space', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-shortcut-heading-',
      initialMarkdown: 'placeholder\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await clearActiveBlock(page)
      await page.keyboard.type('##')
      await page.keyboard.press('Space')
      await page.keyboard.type('Roadmap')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'typing ## + space at paragraph start',
        should: 'persist as an h2 markdown heading',
        actual: disk,
        expected: '## Roadmap\n',
      })
    },
  )
})
