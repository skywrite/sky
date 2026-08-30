import { assert, test } from '#test'
import {
  caretOffset,
  openEditor,
  placeCaret,
  readMarkdownFromDisk,
  ROOT,
  runWysiwygE2e,
  waitForAutosave,
  waitForSettle,
} from './httpWysiwygE2eTestHelpers.ts'

const P = `${ROOT} p.end-block`

test(
  {
    name: 'MODE-4 a very large document edits with one block as the editing host and a slower repaint',
    timeout: 60000,
  },
  async (t) => {
    const big = Array.from({ length: 1700 }, (_, i) => `Paragraph ${i} with **bold** text.`).join('\n\n') + '\n'
    await runWysiwygE2e(t, { tempPrefix: 'wysiwyg-mode-4-', initialMarkdown: big }, async ({ page, origin, file }) => {
      await openEditor(page, origin)
      const busy = await page.evaluate(() => document.querySelector('.sky-wysiwyg')?.getAttribute('contenteditable'))
      await placeCaret(page, `${P}:nth-child(3)`, 11)
      await page.waitForTimeout(80)
      const host = await page.evaluate(() => [
        document.activeElement?.tagName,
        document.activeElement?.getAttribute('contenteditable'),
        document.querySelectorAll('.end-block[contenteditable="true"]').length,
      ])
      await page.keyboard.type(' edited')
      await page.keyboard.press('Enter')
      await page.keyboard.type('new block')
      await page.waitForTimeout(700)
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(80)
      const moved = await page.evaluate(() => [
        document.querySelectorAll('.end-block[contenteditable="true"]').length,
        (document.activeElement as HTMLElement | null)?.dataset.type,
      ])
      await waitForAutosave(page)
      const disk = await readMarkdownFromDisk(file)
      assert({
        given: '1700 paragraphs, a caret placed in the third, typing, Enter, typing, then Down',
        should:
          'make the root non-editable with exactly the focused block editable, keep editing working, and hand the host to the next block',
        actual: [busy, host, moved, disk.split('\n').slice(4, 9)],
        expected: [
          'false',
          ['P', 'true', 1],
          [1, 'paragraph'],
          ['Paragraph 2 edited', '', 'new block with **bold** text.', '', 'Paragraph 3 with **bold** text.'],
        ],
      })
    })
  },
)

test(
  {
    name: 'TAB-4 FMT-13 ENT-5 RT-11 items indent together, blocks move, --- makes front matter, an indented paragraph survives a reload',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-tab-4-', initialMarkdown: '- a\n- b\n- c\n\nlast\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${ROOT} li:nth-child(2) p.end-block`, 0)
        await page.keyboard.press('Shift+ArrowDown')
        await page.keyboard.press('Tab')
        await waitForSettle(page)
        const nested = await readMarkdownFromDisk(file).catch(() => '')
        await placeCaret(page, `${ROOT} > p.end-block`, 0)
        await page.keyboard.press('Alt+Shift+ArrowUp')
        await waitForSettle(page)
        await page.keyboard.press('Alt+Shift+ArrowUp')
        await waitForSettle(page)
        await page.keyboard.type('---')
        await page.keyboard.press('Enter')
        await page.keyboard.type('title: x')
        await placeCaret(page, `${ROOT} > p.end-block`, 0)
        await page.keyboard.type('    ')
        await waitForSettle(page)
        await waitForAutosave(page)
        const disk = await readMarkdownFromDisk(file)
        const reopened = await page.evaluate(async () => {
          const r = await fetch(location.pathname.replace('/explorer/', '/docs/_api/content/'))
          return ((await r.json()) as { content: string }).content
        })
        assert({
          given:
            'Tab over two selected items, Alt+Shift+Up twice on the last paragraph, --- then Enter in the first paragraph, four spaces typed at a paragraph start',
          should:
            'nest both items, move the paragraph to the top, make front matter, and save an indent guard the parser reads back as a paragraph',
          actual: [nested.length >= 0, disk, reopened === disk],
          expected: [true, '---\ntitle: x\n---\n\n​    last\n\n- a\n  - b\n  - c\n', true],
        })
      },
    )
  },
)
