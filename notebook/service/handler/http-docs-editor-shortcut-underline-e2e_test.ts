import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  clearActiveBlock,
  modShortcut,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - underline shortcut wraps selection as inline html', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-shortcut-underline-',
      initialMarkdown: 'placeholder\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await clearActiveBlock(page)
      await page.keyboard.type('Roadmap')
      await page.keyboard.press(modShortcut('a'))
      await page.keyboard.press(modShortcut('u'))
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)
      assert({
        given: 'cmd/ctrl+u with text selected in a visual block',
        should: 'persist inline underline markup using u tags',
        actual: disk,
        expected: '<u>Roadmap</u>\n',
      })
    },
  )
})
