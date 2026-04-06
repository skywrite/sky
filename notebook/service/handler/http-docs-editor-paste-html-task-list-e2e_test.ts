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

test('docs editor e2e - html paste preserves checkbox task list structure', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-paste-html-task-list-',
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
          <ul>
            <li><input type="checkbox" checked> done</li>
            <li><input type="checkbox"> todo</li>
          </ul>
        `,
        '- [x] done\n- [ ] todo',
      )
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)
      assert({
        given: 'html paste with checkbox inputs',
        should: 'persist as markdown task-list items with checked state',
        actual: disk,
        expected: '- [x] done\n- [ ] todo\n',
      })
    },
  )
})
