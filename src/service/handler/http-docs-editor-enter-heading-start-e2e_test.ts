import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - enter at heading start inserts paragraph before heading', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-enter-heading-start-',
      initialMarkdown: '# Demo\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await page.keyboard.press('Home')
      await page.keyboard.press('Enter')
      await page.keyboard.type('Intro')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'enter at the start of an active heading block',
        should: 'insert a new paragraph above without dropping heading content',
        actual: disk,
        expected: 'Intro\n\n# Demo\n',
      })
    },
  )
})
