import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  clearActiveBlock,
  dispatchPasteHtml,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - html table paste converts into readable markdown rows', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-paste-html-table-',
      initialMarkdown: 'seed\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await clearActiveBlock(page)

      await dispatchPasteHtml(
        page,
        '.editable-block[data-active="true"] .editable-block-preview',
        `
          <table>
            <tr><th>Name</th><th>State</th></tr>
            <tr><td>Alpha</td><td>Open</td></tr>
          </table>
        `,
        'Name / State\nAlpha / Open',
      )
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)
      assert({
        given: 'html paste with a table',
        should: 'persist readable row text without corrupting surrounding markdown',
        actual: disk,
        expected: 'Name / State\n\nAlpha / Open\n',
      })
    },
  )
})
