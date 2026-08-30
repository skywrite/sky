import { assert, test } from '#test'
import {
  caretOffset,
  leafTexts,
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
const UNDO = modShortcut('z')
const REDO = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z'
const text = () => document.querySelector('.sky-wysiwyg')?.textContent

test(
  {
    name: 'UND-1 UND-2 UND-8 a run of typing is one step; undo restores text and caret; redo replays; a new edit drops redo',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-und-1-', initialMarkdown: 'Hello\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, P, 5)
        await page.keyboard.type(' there')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await waitForSettle(page)
        await page.keyboard.press(UNDO)
        const afterFirstUndo = [await page.evaluate(text), (await caretOffset(page)).offset]
        await page.keyboard.press(UNDO)
        const afterSecondUndo = [await page.evaluate(text), (await caretOffset(page)).offset]
        await page.keyboard.press(REDO)
        const afterRedo = await page.evaluate(text)
        await page.keyboard.type('!')
        await page.keyboard.press(REDO)
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: 'typing then two deletions, undo twice, redo, a new keystroke, redo again',
          should:
            'undo the deletions as one step, the typing as one, replay the typing, and have nothing to redo after the new edit',
          actual: [afterFirstUndo, afterSecondUndo, afterRedo, await readMarkdownFromDisk(file)],
          expected: [['Hello there', 11], ['Hello', 5], 'Hello there', 'Hello there!\n'],
        })
      },
    )
  },
)

test(
  {
    name: 'UND-3 TYP-17 Enter and a committed conversion are single steps; undo restores the marker text and caret',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-und-3-', initialMarkdown: 'one two\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, P, 3)
        await page.keyboard.press('Enter')
        await page.keyboard.press(UNDO)
        const afterEnterUndo = [
          await page.evaluate(() => document.querySelectorAll('.sky-wysiwyg > *').length),
          (await caretOffset(page)).offset,
        ]
        await placeCaret(page, P, 0)
        await page.keyboard.type('## ')
        await waitForSettle(page)
        await page.keyboard.type('X')
        await waitForSettle(page)
        const committed = await page.evaluate(() => document.querySelector('.sky-wysiwyg > h2') !== null)
        await page.keyboard.press(UNDO)
        const afterCommitUndo = [
          await page.evaluate(() => document.querySelector('.sky-wysiwyg > p')?.textContent),
          (await caretOffset(page)).offset,
        ]
        await page.keyboard.press(UNDO)
        const afterMarkerUndo = await page.evaluate(() => document.querySelector('.sky-wysiwyg > p')?.textContent)
        await placeCaret(page, P, 0)
        await page.keyboard.type('- ')
        await waitForSettle(page)
        const listed = await page.evaluate(() => document.querySelector('.sky-wysiwyg > ul') !== null)
        await page.keyboard.press(UNDO)
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: 'Enter then undo; a heading typed to commit then undone twice; a bullet conversion then undone',
          should:
            'restore one paragraph with the caret at the split, restore "## Xone two" then "one two", and restore the paragraph with its marker',
          actual: [
            afterEnterUndo,
            committed,
            afterCommitUndo,
            afterMarkerUndo,
            listed,
            await readMarkdownFromDisk(file),
          ],
          expected: [[1, 3], true, ['## Xone two', 4], 'one two', true, '- one two\n'],
        })
      },
    )
  },
)

test(
  { name: 'UND-4 UND-7 edits in a fence undo on the same stack; a disk reload is one step', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-und-4-', initialMarkdown: '```js\ncode\n```\n\ntext\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${ROOT} pre.fence`, 4)
        await page.keyboard.type(' more')
        await placeCaret(page, P, 4)
        await page.keyboard.type(' too')
        await waitForSettle(page)
        await page.keyboard.press(UNDO)
        await page.keyboard.press(UNDO)
        const bothUndone = [...(await leafTexts(page, 'pre.fence')), ...(await leafTexts(page, 'p.end-block'))]
        await page.keyboard.press(REDO)
        await page.keyboard.press(REDO)
        await waitForAutosave(page)
        await page.evaluate(() => {
          // nothing: let the save land before the file is rewritten from outside
        })
        const saved = await readMarkdownFromDisk(file)
        await new Promise((resolve) => setTimeout(resolve, 200))
        await (await import('node:fs/promises')).writeFile(file, 'replaced\n')
        await page.waitForFunction(() => document.querySelector('p.end-block')?.textContent === 'replaced', null, {
          timeout: 8000,
        })
        await page.keyboard.press(UNDO)
        await waitForSettle(page)
        assert({
          given:
            'typing in a fence and a paragraph, two undos and two redos, then the file replaced on disk and one undo',
          should: 'undo both edits from one stack, save the redone text, and bring back the pre-reload document',
          actual: [bothUndone, saved, await leafTexts(page, '.sky-wysiwyg > *')],
          expected: [['code', 'text'], '```js\ncode more\n```\n\ntext too\n', ['code more', 'text too']],
        })
      },
    )
  },
)
