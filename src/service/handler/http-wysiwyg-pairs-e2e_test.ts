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
const text = () => document.querySelector('p.end-block')?.textContent

test({ name: 'TYP-19 TYP-21 TYP-23 brackets pair, step over, and delete as a pair', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(t, { tempPrefix: 'wysiwyg-pair-19-', initialMarkdown: 'call \n' }, async ({ page, origin }) => {
    await openEditor(page, origin)
    await placeCaret(page, P, 5)
    await page.keyboard.type('(')
    const paired = [await page.evaluate(text), (await caretOffset(page)).offset]
    await page.keyboard.type('x)')
    const stepped = [await page.evaluate(text), (await caretOffset(page)).offset]
    await page.keyboard.type(' [')
    await page.keyboard.press('Backspace')
    const removed = await page.evaluate(text)
    await placeCaret(page, P, 0)
    await page.keyboard.type('[')
    const noPair = await page.evaluate(text)
    assert({
      given: '"(" at a boundary, "x)" over the closer, " [" then Backspace, "[" before a letter',
      should: 'insert (), step over ), remove [] together, and not pair before a letter',
      actual: [paired, stepped, removed, noPair],
      expected: [['call ()', 6], ['call (x)', 8], 'call (x) ', '[call (x) '],
    })
  })
})

test(
  {
    name: 'TYP-20 TYP-24 TYP-22 UND-6 markers pair at boundaries, ** grows from *, a selection is wrapped, and pairing rides the typing step',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-pair-20-', initialMarkdown: 'say word\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, P, 8)
        await page.keyboard.type(' *')
        const one = [await page.evaluate(text), (await caretOffset(page)).offset]
        await page.keyboard.type('*')
        const two = [await page.evaluate(text), (await caretOffset(page)).offset]
        await page.keyboard.type('bold**')
        await waitForSettle(page)
        const strong = await page.evaluate(() => [
          document.querySelector('p.end-block')?.textContent,
          document.querySelectorAll('p.end-block strong').length,
        ])
        await placeCaret(page, P, 4)
        for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
        await page.keyboard.type('(')
        const wrapped = await page.evaluate(() => [
          document.querySelector('p.end-block')?.textContent,
          document.getSelection()?.toString(),
        ])
        await page.keyboard.press(modShortcut('z'))
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: '" *" then "*" then "bold**" typed, "word" selected and "(" typed, then undo',
          should:
            'pair the star, grow to a double pair, render strong after stepping over the closers, wrap the word keeping it selected, and undo the wrap as one step',
          actual: [one, two, strong, wrapped, await readMarkdownFromDisk(file)],
          expected: [
            ['say word **', 10],
            ['say word ****', 11],
            ['say word **bold**', 1],
            ['say (word) **bold**', 'word'],
            'say word **bold**\n',
          ],
        })
      },
    )
  },
)
