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

test('docs editor e2e - html paste converts into markdown-friendly output', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-paste-html-',
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
          <p>Hello <strong>world</strong> and <a href="https://example.com">site</a>.</p>
          <ul><li>One</li><li>Two</li></ul>
        `,
        'Hello world and site.\n- One\n- Two',
      )
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'sanitized html paste in an active visual block',
        should: 'save markdown with inline formatting and list structure',
        actual: disk,
        expected: 'Hello **world** and [site](https://example.com).\n\n- One\n- Two\n',
      })
    },
  )
})
