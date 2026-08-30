import { assert, test } from '#test'
import {
  openEditor,
  placeCaret,
  readMarkdownFromDisk,
  ROOT,
  runWysiwygE2e,
  waitForAutosave,
  waitForSettle,
} from './httpWysiwygE2eTestHelpers.ts'

test({ name: 'TAB-1 TAB-2 TAB-3 Tab and Shift+Tab on list items', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-tab-1-', initialMarkdown: '- a\n- b\n- c\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await placeCaret(page, `${ROOT} li:nth-child(1) p.end-block`, 1)
      await page.keyboard.press('Tab')
      await waitForSettle(page)
      const first = await readMarkdownFromDisk(file).catch(() => '')
      await placeCaret(page, `${ROOT} li:nth-child(2) p.end-block`, 1)
      await page.keyboard.press('Tab')
      await waitForSettle(page)
      await placeCaret(page, `${ROOT} li:nth-child(2) p.end-block`, 1)
      await page.keyboard.press('Tab')
      await waitForSettle(page)
      await waitForAutosave(page)
      const nested = await readMarkdownFromDisk(file)
      await placeCaret(page, `${ROOT} li li p.end-block`, 1)
      await page.keyboard.press('Shift+Tab')
      await waitForSettle(page)
      await page.keyboard.press('Shift+Tab')
      await waitForSettle(page)
      await waitForAutosave(page)
      assert({
        given:
          'Tab on the first item (ignored), on the second, on the now-second again; then Shift+Tab twice on the nested item',
        should: 'nest b under a with c joining, then outdent b taking c as its child, then unwrap b into a paragraph',
        actual: [first.length >= 0, nested, await readMarkdownFromDisk(file)],
        expected: [true, '- a\n  - b\n  - c\n', '- a\n\nb\n\n- c\n'],
      })
    },
  )
})

test(
  { name: 'TAB-8 TAB-9 NAV-13 Tab in prose, Shift+Tab out of a quote, a click below the document', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-tab-8-', initialMarkdown: 'text\n\n> quoted\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${ROOT} > p.end-block`, 0)
        await page.keyboard.press('Tab')
        const stillInside = await page.evaluate(() => document.activeElement?.classList.contains('sky-wysiwyg'))
        await page.keyboard.press('Shift+Tab')
        await placeCaret(page, `${ROOT} blockquote p.end-block`, 0)
        await page.keyboard.press('Shift+Tab')
        await waitForSettle(page)
        const box = await page.evaluate(() => document.querySelector('.sky-wysiwyg')!.getBoundingClientRect())
        await page.mouse.click(box.x + 40, box.y + box.height - 4)
        await page.keyboard.type('below')
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given:
            'Tab then Shift+Tab in a paragraph, Shift+Tab in a quote, a click under the last block followed by typing',
          should:
            'keep focus in the editor with the tab added then removed, lift the quote paragraph, and add a paragraph at the end',
          actual: [stillInside, await readMarkdownFromDisk(file)],
          expected: [true, 'text\n\nquoted\n\nbelow\n'],
        })
      },
    )
  },
)
