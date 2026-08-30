import { assert, test } from '#test'
import {
  caretOffset,
  openEditor,
  placeCaret,
  readMarkdownFromDisk,
  ROOT,
  runWysiwygE2e,
  syntaxVisible,
  waitForAutosave,
  waitForSettle,
  writeMarkdownToDisk,
} from './httpWysiwygE2eTestHelpers.ts'

const P = `${ROOT} p.end-block`

test(
  {
    name: 'TYP-1 TYP-2 TYP-3 typing a construct renders it after settle, reveals it under the caret, hides it when the caret leaves, and saves',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-typ-1-', initialMarkdown: 'Hello world\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, P, 11)
        await page.keyboard.type(' **bold**')
        const before = await page.evaluate(() => document.querySelector('p.end-block')?.textContent)
        await waitForSettle(page)
        const strong = await page.evaluate(() => document.querySelector('p.end-block strong')?.textContent ?? null)
        const expanded = await syntaxVisible(page, 'p.end-block [data-inline="strong"].expanded')
        const caret = await caretOffset(page)
        await placeCaret(page, P, 0)
        await page.waitForTimeout(50)
        const hidden = await syntaxVisible(page, 'p.end-block [data-inline="strong"]')
        await waitForAutosave(page)
        assert({
          given: 'typing " **bold**" at the end of a paragraph',
          should:
            'show the text at once, render strong after settle with its markers visible, hide them once the caret leaves, keep the caret offset, and save the markdown',
          actual: [before, strong, expanded, caret.offset, hidden, await readMarkdownFromDisk(file)],
          expected: ['Hello world **bold**', 'bold', [true, true], 20, [false, false], 'Hello world **bold**\n'],
        })
      },
    )
  },
)

test({ name: 'TYP-4 an unbalanced marker stays literal', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(t, { tempPrefix: 'wysiwyg-typ-4-', initialMarkdown: 'Hello\n' }, async ({ page, origin }) => {
    await openEditor(page, origin)
    await placeCaret(page, P, 5)
    await page.keyboard.type(' x* a* y **b ** z')
    await waitForSettle(page)
    assert({
      given: 'closers with no opener, and a closer with a space before it',
      should: 'render no emphasis',
      actual: await page.evaluate(() => [
        document.querySelectorAll('p.end-block em, p.end-block strong').length,
        document.querySelector('p.end-block')?.textContent,
      ]),
      expected: [0, 'Hello x* a* y **b ** z'],
    })
  })
})

test(
  { name: 'TYP-8 typing the closing marker renders the construct; deleting it un-renders', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(t, { tempPrefix: 'wysiwyg-typ-8-', initialMarkdown: 'x\n' }, async ({ page, origin }) => {
      await openEditor(page, origin)
      await placeCaret(page, P, 1)
      await page.keyboard.type(' *word')
      await waitForSettle(page)
      const open = await page.evaluate(() => document.querySelectorAll('p.end-block em').length)
      await page.keyboard.type('*')
      await waitForSettle(page)
      const closed = await page.evaluate(() => document.querySelectorAll('p.end-block em').length)
      await page.keyboard.press('Backspace')
      await waitForSettle(page)
      const reopened = await page.evaluate(() => [
        document.querySelectorAll('p.end-block em').length,
        document.querySelector('p.end-block')?.textContent,
      ])
      assert({
        given: '*word, then the closing *, then Backspace',
        should: 'render em only while the pair is complete',
        actual: [open, closed, reopened],
        expected: [1, 1, [0, 'x *word']],
      })
    })
  },
)

test({ name: 'TYP-7 Shift+Enter is a soft break inside the same block', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-typ-7-', initialMarkdown: 'Hello\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await placeCaret(page, P, 5)
      await page.keyboard.press('Shift+Enter')
      await page.keyboard.type('next')
      await waitForSettle(page)
      const caret = await caretOffset(page)
      await waitForAutosave(page)
      assert({
        given: 'Shift+Enter then more text',
        should: 'keep one paragraph with a newline in it, the caret after the typed text, and save a single newline',
        actual: [
          await page.evaluate(() => [
            document.querySelectorAll('p.end-block').length,
            document.querySelector('p.end-block')?.textContent,
          ]),
          caret.offset,
          await readMarkdownFromDisk(file),
        ],
        expected: [[1, 'Hello\nnext'], 10, 'Hello\nnext\n'],
      })
    },
  )
})

test(
  { name: 'TYP-30 four spaces at the start of a paragraph never make a code block while editing', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-typ-30-', initialMarkdown: 'text\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, P, 0)
        await page.keyboard.type('    ')
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: 'four spaces typed at a paragraph start',
          should: 'stay a paragraph and save the spaces behind the guard that keeps it one (RT-11)',
          actual: [
            await page.evaluate(() => document.querySelector('.end-block')?.tagName),
            await readMarkdownFromDisk(file),
          ],
          expected: ['P', '\u200b    text\n'],
        })
      },
    )
  },
)

test({ name: 'TYP-34 an empty file opens with a paragraph to type into', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(t, { tempPrefix: 'wysiwyg-typ-34-', initialMarkdown: '' }, async ({ page, origin, file }) => {
    await openEditor(page, origin)
    await placeCaret(page, P, 0)
    await page.keyboard.type('first words')
    await waitForSettle(page)
    await waitForAutosave(page)
    assert({
      given: 'an empty file and some typing',
      should: 'have one paragraph and save it with a final newline',
      actual: [
        await page.evaluate(() => document.querySelectorAll('.end-block').length),
        await readMarkdownFromDisk(file),
      ],
      expected: [1, 'first words\n'],
    })
  })
})

test({ name: 'RT-4 editing one block saves only that block', timeout: 30000 }, async (t) => {
  const source = '# Title\n\n- one\n- two\n\n> quote\n\nLast   paragraph.\n'
  await runWysiwygE2e(t, { tempPrefix: 'wysiwyg-rt-4-', initialMarkdown: source }, async ({ page, origin, file }) => {
    await openEditor(page, origin)
    await placeCaret(page, `${ROOT} li p.end-block`, 3)
    await page.keyboard.type(' item')
    await waitForSettle(page)
    await waitForAutosave(page)
    assert({
      given: 'text typed into the first list item',
      should: 'change only that line on disk',
      actual: await readMarkdownFromDisk(file),
      expected: source.replace('- one', '- one item'),
    })
  })
})

test({ name: 'LST-3 clicking a checkbox toggles the task and saves it', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-lst-3-', initialMarkdown: '- [ ] task\n- [x] done\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await page.click('li.task input[type="checkbox"]')
      await waitForAutosave(page)
      assert({
        given: 'a click on the open task box',
        should: 'save it checked and mark the item done',
        actual: [
          await readMarkdownFromDisk(file),
          await page.evaluate(() => document.querySelector('li.task')?.className),
        ],
        expected: ['- [x] task\n- [x] done\n', 'task done'],
      })
    },
  )
})

test(
  { name: 'MODE-5 a file changed on disk reloads in place while the editor is clean', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-mode-5-', initialMarkdown: 'before\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await writeMarkdownToDisk(file, 'after the change\n')
        await page.waitForFunction(
          () => document.querySelector('p.end-block')?.textContent === 'after the change',
          null,
          {
            timeout: 8000,
          },
        )
        await placeCaret(page, P, 16)
        await page.keyboard.type('!')
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: 'the file rewritten outside the editor, then a keystroke',
          should: 'show the new content within a poll and keep editing it',
          actual: await readMarkdownFromDisk(file),
          expected: 'after the change!\n',
        })
      },
    )
  },
)
