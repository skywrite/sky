import { assert, test } from '#test'
import {
  activateFirstEditableBlock,
  openDocsEditor,
  readMarkdownFromDisk,
  runDocsEditorE2e,
  waitForAutosave,
} from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - backspace unwrap preserves nested child list items', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-list-unwrap-nested-',
      initialMarkdown: '- parent\n  - child\n',
    },
    async ({ page, origin, previewFile }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await page.evaluate(() => {
        const item = document.querySelector('.editable-block[data-active="true"] .editable-block-preview > ul > li')
        if (!(item instanceof HTMLElement)) {
          throw new Error('Top-level list item not found')
        }

        const textNode = item.firstChild
        const range = document.createRange()
        if (textNode) {
          range.setStart(textNode, 0)
        } else {
          range.selectNodeContents(item)
        }
        range.collapse(true)

        const selection = document.getSelection()
        if (!selection) {
          throw new Error('Unable to access selection')
        }

        selection.removeAllRanges()
        selection.addRange(range)
      })
      await page.keyboard.press('Backspace')
      await waitForAutosave(page)

      const disk = await readMarkdownFromDisk(previewFile)

      assert({
        given: 'backspace at start of a top-level list item with nested children',
        should: 'unwrap to paragraph while preserving nested child items as list entries',
        actual: disk,
        expected: 'parent\n\n- child\n',
      })
    },
  )
})
