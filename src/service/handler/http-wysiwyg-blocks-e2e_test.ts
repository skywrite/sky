import { assert, test } from '#test'
import {
  caretOffset,
  leafTexts,
  openEditor,
  placeCaret,
  readMarkdownFromDisk,
  ROOT,
  runWysiwygE2e,
  waitForAutosave,
  waitForSettle,
  writeSiblingPng,
} from './httpWysiwygE2eTestHelpers.ts'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |\n'
const cellText = () =>
  (
    (document.getSelection()?.anchorNode instanceof Element
      ? document.getSelection()?.anchorNode
      : document.getSelection()?.anchorNode?.parentElement) as Element | null | undefined
  )?.closest('[data-type="table_cell"]')?.textContent ?? null

test({ name: 'ENT-17 TAB-5 ENT-8 DEL-20 ENT-7 TBL-1 keys inside a table', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-tbl-keys-', initialMarkdown: `${TABLE}\nafter\n` },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await placeCaret(page, `${ROOT} [data-type="table_cell"]`, 1)
      await page.keyboard.press('Enter')
      const belowSelected = [
        await page.evaluate(cellText),
        await page.evaluate(() => document.getSelection()?.toString()),
      ]
      await page.keyboard.press('Tab')
      const next = [await page.evaluate(cellText), await page.evaluate(() => document.getSelection()?.toString())]
      await page.keyboard.press('Tab')
      const appended = await page.evaluate(() => document.querySelectorAll('.sky-wysiwyg tr').length)
      await page.keyboard.type('new')
      await page.keyboard.press('Shift+Enter')
      await page.keyboard.type('line')
      await page.keyboard.press(`${mod}+Enter`)
      const rowsAfterCmdEnter = await page.evaluate(() => document.querySelectorAll('.sky-wysiwyg tr').length)
      await page.keyboard.press(`${mod}+Shift+Backspace`)
      const rowsAfterDelete = await page.evaluate(() => document.querySelectorAll('.sky-wysiwyg tr').length)
      await page.keyboard.press('Enter')
      await waitForSettle(page)
      const left = await caretOffset(page)
      await waitForAutosave(page)
      assert({
        given:
          'Enter, Tab twice, typing with a Shift+Enter, Cmd+Enter, Cmd+Shift+Backspace, then Enter in the last row',
        should:
          'move below selecting the cell, move right, append a row, add and delete rows, leave the table, and save the re-padded table with a literal <br>',
        actual: [
          belowSelected,
          next,
          appended,
          rowsAfterCmdEnter,
          rowsAfterDelete,
          left.offset,
          await readMarkdownFromDisk(file),
        ],
        expected: [
          ['1', '1'],
          ['2', '2'],
          3,
          4,
          3,
          0,
          '| a           | b   |\n| ----------- | --- |\n| 1           | 2   |\n| new<br>line |     |\n\nafter\n',
        ],
      })
    },
  )
})

test(
  { name: 'DEL-6 TBL-2 TBL-3 Backspace at a cell start, the tools, and re-padding after an edit', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-tbl-tools-', initialMarkdown: TABLE },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        const cells = `${ROOT} [data-type="table_cell"]`
        await placeCaret(page, `${cells}:nth-of-type(1)`, 0)
        await page.waitForTimeout(80)
        const tools = await page.evaluate(() => document.querySelector('.table-tools') !== null)
        await page.evaluate(() => {
          const cell = document.querySelectorAll('[data-type="table_cell"]')[3] as HTMLElement
          const text = cell.firstChild!.firstChild ?? cell
          const range = document.createRange()
          range.setStart(text, 0)
          range.collapse(true)
          document.getSelection()!.removeAllRanges()
          document.getSelection()!.addRange(range)
        })
        await page.keyboard.press('Backspace')
        const back = await page.evaluate(cellText)
        await page.keyboard.type('x')
        await page.click('[data-table-action="col-right"]')
        await waitForSettle(page)
        await page.click('[data-table-action="align-right"]')
        await waitForSettle(page)
        const caretCell = await page.evaluate(cellText)
        await waitForAutosave(page)
        assert({
          given:
            'the caret in a table, Backspace at a body cell start, a keystroke, then the add-column and align-right tools',
          should: 'show the tools, move to the previous cell, and save the edited, widened, aligned table',
          actual: [tools, back, caretCell, await readMarkdownFromDisk(file)],
          expected: [true, '1', '1x', '|   a |     | b   |\n| --: | --- | --- |\n|  1x |     | 2   |\n'],
        })
      },
    )
  },
)

test(
  {
    name: 'IMG-1 IMG-2 IMG-4 DEL-19 images resolve through the file API, open their source on click, render from <img> tags, and go with one Backspace',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        tempPrefix: 'wysiwyg-img-',
        initialMarkdown: 'see ![dot](dot.png) here\n\n<img src="dot.png" width="8"> tag\n',
      },
      async ({ page, origin, file }) => {
        await writeSiblingPng(file, 'dot.png')
        await openEditor(page, origin)
        await page.waitForTimeout(300)
        const loaded = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLImageElement>('.sky-wysiwyg img')].map((img) => [
            img.getAttribute('src'),
            img.naturalWidth,
          ]),
        )
        await page.evaluate(() => {
          const img = document.querySelector('.sky-wysiwyg [data-inline="image"] img')!
          img.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
          document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        })
        const revealed = await page.evaluate(() => {
          const island = document.querySelector('[data-inline="image"]')!
          return [
            island.classList.contains('expanded'),
            getComputedStyle(island.querySelector('.syntax')!).display !== 'none',
          ]
        })
        await page.keyboard.type('!')
        await waitForSettle(page)
        const edited = await page.evaluate(() => document.querySelector('p.end-block')?.textContent)
        await page.evaluate(() => {
          // The caret right after the island, in the text that follows it (DEL-19).
          const island = document.querySelector('[data-inline="image"]')!
          const after = island.nextSibling!.firstChild!
          const range = document.createRange()
          range.setStart(after, 0)
          range.collapse(true)
          const selection = document.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
          ;(document.querySelector('.sky-wysiwyg') as HTMLElement).focus()
          selection.removeAllRanges()
          selection.addRange(range)
        })
        await page.keyboard.press('Backspace')
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given:
            'a markdown image and an <img> tag next to a real PNG, a click on the image then a keystroke, then Backspace right after the island',
          should:
            'load both through the file API, reveal the source and take the key into it, and delete the whole image',
          actual: [loaded, revealed, edited, await readMarkdownFromDisk(file)],
          expected: [
            [
              ['/docs/_api/file/notes/dot.png', 1],
              ['/docs/_api/file/notes/dot.png', 1],
            ],
            [true, true],
            'see ![dot](dot.png)! here',
            'see ! here\n\n<img src="dot.png" width="8"> tag\n',
          ],
        })
      },
    )
  },
)

test({ name: 'FEN-1 FEN-2 TAB-7 the language box, auto-indent, and outdent in a fence', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-fence-', initialMarkdown: '```\nif x:\n    y\n```\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await page.click('.sky-wysiwyg .fence-lang > span')
      await page.keyboard.type('python')
      await page.keyboard.press('Enter')
      const inCode = await caretOffset(page)
      await placeCaret(page, `${ROOT} pre.fence`, 11)
      await page.keyboard.press('Enter')
      await page.keyboard.type('z')
      const [indented] = await leafTexts(page, 'pre.fence')
      await page.keyboard.press('Shift+Tab')
      await waitForSettle(page)
      await waitForAutosave(page)
      assert({
        given:
          'a language typed into the box then Enter, Enter at the end of an indented line then a letter, then Shift+Tab',
        should:
          'commit the language with the caret in the code, keep the indentation on the new line, and take one level off',
        actual: [inCode.offset, indented, await readMarkdownFromDisk(file)],
        expected: [0, 'if x:\n    y\n    z', '```python\nif x:\n    y\nz\n```\n'],
      })
    },
  )
})

const inFence = () => {
  const anchor = document.getSelection()?.anchorNode
  const element = anchor instanceof Element ? anchor : anchor?.parentElement
  return element?.closest('pre.fence') !== null && element !== undefined
}

test(
  {
    name: 'FEN-1 ENT-7 code is colored by its language, stays itself while typing, and Shift+Enter stays inside',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-fence-color-', initialMarkdown: "```JavaScript\nconsole.log('hello')\n```\n\nafter\n" },
      async ({ page, origin, file, errors }) => {
        await openEditor(page, origin)
        const colored = await page.evaluate(() =>
          [...document.querySelectorAll('pre.fence .hljs-string')].map((span) => span.textContent),
        )
        await placeCaret(page, `${ROOT} pre.fence`, 20)
        await page.keyboard.type(' // hi')
        await waitForSettle(page)
        const comment = await page.evaluate(
          () => document.querySelector('pre.fence .hljs-comment')?.textContent ?? null,
        )
        const afterTyping = await caretOffset(page)
        await page.keyboard.press('Shift+Enter')
        await page.keyboard.press('Shift+Enter')
        await page.keyboard.type('x')
        await waitForSettle(page)
        const stayed = await page.evaluate(inFence)
        await page.click('.sky-wysiwyg .fence-lang > span')
        await page.keyboard.press('End')
        for (let i = 0; i < 'JavaScript'.length; i++) await page.keyboard.press('Backspace')
        await page.keyboard.type('text')
        await page.keyboard.press('Enter')
        await waitForSettle(page)
        const plain = await page.evaluate(() => document.querySelectorAll('pre.fence [class^="hljs-"]').length)
        await waitForAutosave(page)
        assert({
          given:
            'a JavaScript fence; a comment typed at its end; Shift+Enter twice on its last line then a letter; the language changed to text',
          should:
            'color the string, color the comment with the caret after it, keep Shift+Enter inside the fence, drop the color for text, and save the code as typed',
          actual: [colored, comment, afterTyping.offset, stayed, plain, await readMarkdownFromDisk(file), errors],
          expected: [["'hello'"], '// hi', 26, true, 0, "```text\nconsole.log('hello') // hi\n\nx\n```\n\nafter\n", []],
        })
      },
    )
  },
)

test({ name: 'FEN-1 a document reads with the colors it is edited with', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-read-color-', initialMarkdown: "```JavaScript\nconsole.log('hello')\n```\n" },
    async ({ page, origin, errors }) => {
      await page.goto(`${origin}/explorer/notes/preview.md`)
      await page.waitForSelector('.sky-doc-body pre code .hljs-string')
      // The page re-renders for many reasons — a text-size change is one — and the color must survive it.
      await page.getByLabel('More').click()
      await page.getByRole('menuitem', { name: 'Larger' }).click()
      await page.getByRole('menuitem', { name: 'Default size' }).click()
      await page.keyboard.press('Escape')
      await waitForSettle(page)
      const [strings, text] = await page.evaluate(() => [
        [...document.querySelectorAll('.sky-doc-body pre code .hljs-string')].map((span) => span.textContent),
        document.querySelector('.sky-doc-body pre code')?.textContent ?? null,
      ])
      assert({
        given: 'a document with a JavaScript fence opened to read, then the page re-rendered by a text-size change',
        should: 'show its string colored still, its code unchanged, without errors',
        actual: [strings, text, errors],
        expected: [["'hello'"], "console.log('hello')\n", []],
      })
    },
  )
})
