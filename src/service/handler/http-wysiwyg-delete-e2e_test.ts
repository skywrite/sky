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

test({ name: 'DEL-7 DEL-8 DEL-12 DEL-13 Backspace at a block start', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-del-7-', initialMarkdown: 'a\n\n---\n\nb\n\n# Head\n\n- one\n\nafter list\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await placeCaret(page, `${ROOT} > p.end-block:nth-child(3)`, 0)
      await page.keyboard.press('Backspace')
      await waitForSettle(page)
      const afterRule = await page.evaluate(() => document.querySelectorAll('.sky-wysiwyg > *').length)
      await placeCaret(page, `${ROOT} > p.end-block:nth-child(1)`, 1)
      await page.keyboard.press('Enter')
      await placeCaret(page, `${ROOT} > p.end-block:nth-child(3)`, 0)
      await page.keyboard.press('Backspace')
      await waitForSettle(page)
      const afterEmpty = await page.evaluate(() => document.querySelectorAll('.sky-wysiwyg > *').length)
      await placeCaret(page, `${ROOT} > h1.end-block`, 0)
      await page.keyboard.press('Backspace')
      await waitForSettle(page)
      await placeCaret(page, `${ROOT} > p.end-block:last-child`, 0)
      await page.keyboard.press('Backspace')
      const joined = await caretOffset(page)
      await waitForSettle(page)
      await waitForAutosave(page)
      assert({
        given:
          'Backspace after a rule, after an empty paragraph made by Enter, at a heading start, and at the start of a paragraph after a list',
        should:
          'delete the rule, delete the empty paragraph, make the heading a paragraph, and join the last item at the junction',
        actual: [afterRule, afterEmpty, joined.offset, await readMarkdownFromDisk(file)],
        expected: [5, 5, 3, 'a\n\nb\n\nHead\n\n- oneafter list\n'],
      })
    },
  )
})

test({ name: 'DEL-9 DEL-10 DEL-11 Backspace at the start of items and quotes', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-del-9-', initialMarkdown: '- [ ] task\n- two\n- three\n\n> q1\n>\n> q2\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await placeCaret(page, `${ROOT} li:nth-child(1) p.end-block`, 0)
      await page.keyboard.press('Backspace')
      await waitForSettle(page)
      const noBox = await page.evaluate(() => document.querySelectorAll('li.task').length)
      await page.keyboard.press('Backspace')
      await waitForSettle(page)
      await placeCaret(page, `${ROOT} li:nth-child(2) p.end-block`, 0)
      await page.keyboard.press('Backspace')
      await waitForSettle(page)
      await placeCaret(page, `${ROOT} blockquote p.end-block`, 0)
      await page.keyboard.press('Backspace')
      await waitForSettle(page)
      await waitForAutosave(page)
      assert({
        given: 'Backspace on a task item (twice), on a later item, and on a quote’s first paragraph',
        should: 'drop the box, then lift the item out, join the previous item, and lift the paragraph out of the quote',
        actual: [noBox, await readMarkdownFromDisk(file)],
        expected: [0, 'task\n\n- two\n  three\n\nq1\n\n> q2\n'],
      })
    },
  )
})

test(
  { name: 'DEL-15 DEL-16 DEL-22 DEL-24 Delete at an end and selections across blocks', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-del-15-', initialMarkdown: 'first\n\n# Head\n\nkeep\n\n---\n\n- gone\n\nlast words\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${ROOT} > p.end-block:nth-child(1)`, 5)
        await page.keyboard.press('Delete')
        await waitForSettle(page)
        await placeCaret(page, `${ROOT} > p.end-block:nth-child(1)`, 9)
        await page.keyboard.press('Enter')
        await page.keyboard.press('Delete')
        await waitForSettle(page)
        const afterEmpty = await page.evaluate(() =>
          [...document.querySelectorAll('.sky-wysiwyg > *')].map((el) => el.tagName),
        )
        await page.evaluate(() => {
          const leaves = [...document.querySelectorAll('.sky-wysiwyg .end-block')]
          const from = leaves[1]!.querySelector('[data-inline="plain"]')!.firstChild!
          const to = leaves[leaves.length - 1]!.querySelector('[data-inline="plain"]')!.firstChild!
          const range = document.createRange()
          range.setStart(from, 2)
          range.setEnd(to, 5)
          const selection = document.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
        })
        await page.keyboard.press('Backspace')
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given:
            'Delete before a heading, Delete in an empty paragraph made by Enter, then a selection from "keep" across a rule and a list into the last paragraph',
          should: 'merge the heading text, remove the empty block, and merge the ends dropping everything between',
          actual: [afterEmpty, await readMarkdownFromDisk(file)],
          expected: [['P', 'P', 'DIV', 'UL', 'P'], 'firstHead\n\nkewords\n'],
        })
      },
    )
  },
)

test(
  { name: 'DEL-21 ENT-9 deleting or replacing a selection inside a construct takes its markers', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-del-21-', initialMarkdown: 'say **bold** now\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await page.evaluate(() => {
          const strong = document.querySelector('.sky-wysiwyg strong')!.firstChild!.firstChild!
          const range = document.createRange()
          range.setStart(strong, 0)
          range.setEnd(strong, 4)
          const selection = document.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
        })
        await page.keyboard.press('Backspace')
        await waitForSettle(page)
        const afterDelete = await page.evaluate(() => document.querySelector('p.end-block')?.textContent)
        await placeCaret(page, `${ROOT} p.end-block`, 4)
        await page.keyboard.type('x')
        await page.evaluate(() => {
          const p = document.querySelector('p.end-block')!
          const text = p.querySelector('[data-inline="plain"]')!.firstChild!
          const range = document.createRange()
          range.setStart(text, 0)
          range.setEnd(text, 3)
          const selection = document.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
        })
        await page.keyboard.press('Enter')
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: 'the word inside **bold** selected and deleted, then a selection replaced by Enter',
          should: 'remove the markers with the word, then delete the selection before splitting',
          actual: [afterDelete, await readMarkdownFromDisk(file)],
          expected: ['say  now', '\n\n x now\n'],
        })
      },
    )
  },
)
