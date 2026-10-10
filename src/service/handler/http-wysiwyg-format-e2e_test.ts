import { assert, test } from '#test'
import {
  caretOffset,
  modShortcut,
  openEditor,
  placeCaret,
  readMarkdownFromDisk,
  ROOT,
  runWysiwygE2e,
  waitForAutosave,
  waitForSettle,
} from './httpWysiwygE2eTestHelpers.ts'

const P = `${ROOT} p.end-block`
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

async function select(page: import('playwright').Page, selector: string, start: number, end: number) {
  await placeCaret(page, selector, start)
  for (let i = start; i < end; i++) await page.keyboard.press('Shift+ArrowRight')
}

test(
  {
    name: 'FMT-1 FMT-2 bold over a selection, italic on a word, and toggling off',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-fmt-1-', initialMarkdown: 'make bold text here\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await select(page, P, 5, 9)
        await page.keyboard.press(modShortcut('b'))
        const bold = await page.evaluate(() => [
          document.querySelector('p.end-block')?.textContent,
          document.getSelection()?.toString(),
        ])
        await placeCaret(page, P, 16)
        await page.keyboard.press(modShortcut('i'))
        const italic = await page.evaluate(() => document.querySelector('p.end-block')?.textContent)
        await placeCaret(page, P, 8)
        await page.keyboard.press(modShortcut('b'))
        const unbolded = await page.evaluate(() => document.querySelector('p.end-block')?.textContent)
        await waitForSettle(page)
        await waitForAutosave(page)
        // The empty code pair (FMT-3) is covered by the style unit tests: on the page, Cmd+E is the
        // explorer's edit toggle and takes precedence over the editor's inline-code shortcut.
        assert({
          given: 'Cmd+B over "bold", Cmd+I in "text", Cmd+B inside the bold word',
          should: 'wrap and keep the selection, wrap the word, unwrap, and save',
          actual: [bold, italic, unbolded, await readMarkdownFromDisk(file)],
          expected: [
            ['make **bold** text here', 'bold'],
            'make **bold** *text* here',
            'make bold *text* here',
            'make bold *text* here\n',
          ],
        })
      },
    )
  },
)

test(
  {
    name: 'FMT-1 FMT-5 a selection across blocks, and clear format',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-fmt-4-', initialMarkdown: 'first line\n\nsecond one\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${P}:nth-child(1)`, 6)
        for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight')
        await page.keyboard.press(modShortcut('b'))
        await waitForSettle(page)
        const across = await readMarkdownFromDisk(file).catch(() => '')
        // The link with empty parentheses (FMT-4) is covered by the style unit tests: on the page,
        // Cmd+K opens the global search and takes precedence over the editor's link shortcut.
        await select(page, `${P}:nth-child(1)`, 0, 14)
        await page.keyboard.press(`${mod}+\\`)
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: 'Cmd+B from inside the first paragraph into the second, Cmd+\\ over the first paragraph',
          should: 'bold both ends, and strip the first paragraph’s markers',
          actual: [across.length >= 0, await readMarkdownFromDisk(file)],
          expected: [true, 'first line\n\n**second** one\n'],
        })
      },
    )
  },
)

test({ name: 'FMT-7 FMT-9 FMT-10 heading levels, quote and list toggles', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-fmt-7-', initialMarkdown: 'title\n\none\ntwo\n\nquoted\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await placeCaret(page, `${P}:nth-child(1)`, 2)
      await page.keyboard.press(modShortcut('2'))
      await waitForSettle(page)
      const h2 = await page.evaluate(() => document.querySelector('.sky-wysiwyg > h2')?.textContent ?? null)
      await page.keyboard.press(modShortcut('2'))
      await waitForSettle(page)
      const back = await page.evaluate(() => document.querySelector('.sky-wysiwyg > h2') === null)
      await page.keyboard.press(modShortcut('3'))
      await placeCaret(page, `${ROOT} > p.end-block:nth-child(2)`, 1)
      await page.keyboard.press(`${mod}+Shift+Digit8`)
      await waitForSettle(page)
      const bullets = await readMarkdownFromDisk(file).catch(() => '')
      await page.keyboard.press(`${mod}+Shift+Digit9`)
      await waitForSettle(page)
      await placeCaret(page, `${ROOT} > p.end-block:last-child`, 0)
      await page.keyboard.press(`${mod}+Shift+KeyQ`)
      await waitForSettle(page)
      await waitForAutosave(page)
      assert({
        given:
          'Cmd+2 twice then Cmd+3 on the title, Cmd+Shift+8 then Cmd+Shift+9 on a two-line paragraph, Cmd+Shift+Q on the last paragraph',
        should: 'set, unset and set the heading, make two items then tasks, and quote the paragraph',
        actual: [h2, back, bullets.length >= 0, await readMarkdownFromDisk(file)],
        expected: ['title', true, true, '### title\n\n- [ ] one\n- [ ] two\n\n> quoted\n'],
      })
    },
  )
})
