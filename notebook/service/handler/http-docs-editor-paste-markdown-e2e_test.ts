import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  clearActiveBlock,
  dispatchPasteData,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - markdown paste converts into structured markdown output', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-paste-markdown-',
      initialMarkdown: 'seed\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await clearActiveBlock(page)

      await dispatchPasteData(page, '.editable-block[data-active="true"] .editable-block-preview', {
        markdown: '## Plan\n\n- one\n- two',
        plainText: '## Plan\n\n- one\n- two',
      })
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'markdown paste in an active visual block',
        should: 'save parsed heading and list markdown',
        actual: disk,
        expected: '## Plan\n\n- one\n- two\n',
      })
    },
  )
})
