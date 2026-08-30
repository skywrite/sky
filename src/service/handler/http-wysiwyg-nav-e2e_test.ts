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
const expandedStrong = () => document.querySelector('[data-inline="strong"]')?.classList.contains('expanded') ?? false
const blockCount = () => document.querySelectorAll('.sky-wysiwyg > *').length

test(
  { name: 'NAV-1 NAV-2 NAV-20 Left and Right step over hidden syntax, cross blocks, and extend', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-nav-1-', initialMarkdown: 'ab **bold** cd\n\nnext\n' },
      async ({ page, origin }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${P}:nth-child(1)`, 3)
        const steps: Array<[number, boolean]> = []
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press('ArrowRight')
          steps.push([(await caretOffset(page)).offset, await page.evaluate(expandedStrong)])
        }
        await placeCaret(page, `${P}:nth-child(1)`, 14)
        await page.keyboard.press('ArrowRight')
        const intoNext = await caretOffset(page)
        await page.keyboard.press('ArrowLeft')
        const backToEnd = await caretOffset(page)
        await page.keyboard.press('Shift+ArrowRight')
        const extended = await page.evaluate(() => {
          const selection = document.getSelection()!
          const leafOf = (node: Node | null) =>
            (node instanceof Element ? node : node?.parentElement)?.closest('.end-block')?.textContent
          return [leafOf(selection.anchorNode), leafOf(selection.focusNode), selection.isCollapsed]
        })
        assert({
          given: 'Right three times from before **bold**, Right at the block end, Left back, Shift+Right at the end',
          should:
            'reveal the markers as the caret enters them, hop to the next block and back, and extend across the edge',
          actual: [steps, intoNext.offset, backToEnd.offset, extended],
          expected: [
            [
              [4, true],
              [5, true],
              [6, true],
            ],
            0,
            14,
            ['ab **bold** cd', 'next', false],
          ],
        })
      },
    )
  },
)

test(
  {
    name: 'NAV-4 NAV-5 NAV-6 Up and Down leave a block from its edge lines at the same x; Down past the end makes a temporary paragraph',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-nav-4-', initialMarkdown: 'short\n\na much longer paragraph line\n' },
      async ({ page, origin }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${P}:nth-child(2)`, 29)
        await page.keyboard.press('ArrowUp')
        const up = await caretOffset(page)
        await page.keyboard.press('ArrowUp')
        const upAgain = await caretOffset(page)
        await page.keyboard.press('ArrowDown')
        const down = await caretOffset(page)
        await page.keyboard.press('ArrowDown')
        const below = [await page.evaluate(blockCount), (await caretOffset(page)).offset]
        await page.keyboard.press('ArrowUp')
        await waitForSettle(page)
        const back = [await page.evaluate(blockCount), (await caretOffset(page)).block]
        assert({
          given: 'Up from the long line’s end, Up at the top, Down back, Down past the last block, Up again',
          should:
            'land at the short line’s end, stay put, return near the same x, add a temporary paragraph, and drop it on leaving',
          actual: [up.offset, upAgain.offset, down.offset >= 20, below, back[0]],
          expected: [5, 5, true, [3, 0], 2],
        })
      },
    )
  },
)

test(
  {
    name: 'ATOM NAV-2 NAV-15 DEL-17 ENT-22 TYP-33 a rule is selected whole on the way, ignores typing, and Backspace removes it',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-atom-', initialMarkdown: 'before\n\n---\n\nafter\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${P}:nth-child(1)`, 6)
        await page.keyboard.press('ArrowRight')
        const selected = await page.evaluate(() => document.querySelector('.atom.selected') !== null)
        await page.keyboard.type('x')
        await page.keyboard.press('Enter')
        const untouched = await page.evaluate(() => [
          document.querySelector('p.end-block')?.textContent,
          document.querySelectorAll('.sky-wysiwyg > *').length,
        ])
        await page.keyboard.press('ArrowRight')
        const after = await caretOffset(page)
        await page.keyboard.press('ArrowLeft')
        const reselected = await page.evaluate(() => document.querySelector('.atom.selected') !== null)
        await page.keyboard.press('Backspace')
        const landed = await caretOffset(page)
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: 'Right onto a rule, a keystroke and Enter, Right past it, Left back onto it, Backspace',
          should:
            'select the rule, ignore the key and Enter, move to the next block, reselect it, and delete it with the caret before it',
          actual: [selected, untouched, after.offset, reselected, landed.offset, await readMarkdownFromDisk(file)],
          expected: [true, ['before', 3], 0, true, 6, 'before\n\nafter\n'],
        })
      },
    )
  },
)

test(
  {
    name: 'NAV-21 NAV-14 Select All inside a fence is scoped, then whole; a click in the margin lands at the block end',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-nav-21-', initialMarkdown: '```js\ncode here\n```\n\ntext\n' },
      async ({ page, origin }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${ROOT} pre.fence`, 2)
        await page.keyboard.press(modShortcut('a'))
        const first = await page.evaluate(() => document.getSelection()?.toString())
        await page.keyboard.press(modShortcut('a'))
        const second = await page.evaluate(() => document.getSelection()?.toString().includes('text'))
        const box = await page.evaluate(() => {
          const p = document.querySelector('p.end-block')!.getBoundingClientRect()
          const root = document.querySelector('.sky-wysiwyg')!.getBoundingClientRect()
          return { x: root.right - 8, y: p.top + p.height / 2 }
        })
        await page.mouse.click(box.x, box.y)
        const margin = await caretOffset(page)
        assert({
          given: 'Cmd+A twice inside a fence, then a click in the right margin beside the paragraph',
          should: 'select the code, then the whole document, then put the caret at the paragraph end',
          actual: [first, second, margin.offset],
          expected: ['code here', true, 4],
        })
      },
    )
  },
)

test(
  {
    name: 'NAV-7 NAV-3 Down enters a table under the caret’s x and walks its rows; Right at a cell end goes to the next cell',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-nav-7-', initialMarkdown: 'text\n\n| a | b |\n|---|---|\n| 1 | 2 |\n' },
      async ({ page, origin }) => {
        await openEditor(page, origin)
        await placeCaret(page, P, 0)
        await page.keyboard.press('ArrowDown')
        const cellText = () =>
          page.evaluate(() => {
            const anchor = document.getSelection()?.anchorNode
            return (
              (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('[data-type="table_cell"]')
                ?.textContent ?? null
            )
          })
        const first = await cellText()
        await page.keyboard.press('ArrowDown')
        const second = await cellText()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
        const third = await cellText()
        assert({
          given: 'Down from the paragraph start into the table, Down again, then Right twice from the end of a cell',
          should: 'land in the first column of the header, then the body, then the next cell',
          actual: [first, second, third],
          expected: ['a', '1', '2'],
        })
      },
    )
  },
)
