import { assert, test } from '#test'
import { activateFirstEditableBlock, openDocsEditor, runDocsEditorE2e } from './httpDocsEditorE2eTestHelpers.ts'

test('docs editor e2e - inline syntax reveal toggles on active inline focus', async (t) => {
  await runDocsEditorE2e(
    t,
    {
      tempPrefix: 'http-docs-e2e-inline-reveal-focus-',
      initialMarkdown: 'alpha **beta** gamma\n',
    },
    async ({ page, origin }) => {
      await openDocsEditor(page, origin)
      await activateFirstEditableBlock(page)
      await page.evaluate(() => {
        const strong = document.querySelector('.editable-block[data-active="true"] .editable-block-preview strong')
        if (!(strong instanceof HTMLElement)) {
          throw new Error('Formatted inline target not found')
        }

        const textNode = strong.firstChild
        const range = document.createRange()
        if (textNode) {
          range.setStart(textNode, 0)
        } else {
          range.selectNodeContents(strong)
        }
        range.collapse(true)

        const selection = document.getSelection()
        if (!selection) {
          throw new Error('Unable to access selection')
        }

        selection.removeAllRanges()
        selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      })

      const inlineState = await page.evaluate(() => {
        const article = document.querySelector('.editable-block[data-active="true"] .editable-block-preview')
        if (!(article instanceof HTMLElement)) {
          throw new Error('Active visual block article not found')
        }

        const focused = article.querySelector('[data-inline-focus="true"]')
        return {
          focusedTag: focused instanceof HTMLElement ? focused.tagName.toLowerCase() : null,
          reveal: article.getAttribute('data-inline-reveal'),
        }
      })

      assert({
        given: 'caret moved into a formatted inline segment',
        should: 'enable inline reveal mode for the active visual block',
        actual: inlineState.reveal,
        expected: 'true',
      })

      assert({
        given: 'caret moved into a formatted inline segment',
        should: 'mark the focused inline formatting element',
        actual: inlineState.focusedTag,
        expected: 'strong',
      })
    },
  )
})
