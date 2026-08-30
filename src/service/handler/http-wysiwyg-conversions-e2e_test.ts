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
  { name: 'TYP-9 a list marker at the line start makes a list item at once, keeping the caret', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-typ-9-', initialMarkdown: 'first\n\nmore\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, P, 0)
        await page.keyboard.type('- ')
        await waitForSettle(page)
        const afterBullet = await page.evaluate(() => [
          document.querySelector('.sky-wysiwyg > ul[data-bullet="-"] > li > p.end-block')?.textContent ?? null,
          document.querySelectorAll('.sky-wysiwyg > p').length,
        ])
        const caret = await caretOffset(page)
        await page.keyboard.type('x')
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: '"- " typed at the start of a paragraph, then a letter',
          should: 'turn it into a bullet item with the marker consumed and the caret at the same text position',
          actual: [afterBullet, caret.offset, await readMarkdownFromDisk(file)],
          expected: [['first', 1], 0, '- xfirst\n\nmore\n'],
        })
      },
    )
  },
)

test(
  { name: 'TYP-9 a numbered marker makes an ordered list; a marker after a same list joins it', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-typ-9b-', initialMarkdown: '- one\n\nnext\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${ROOT} > p.end-block`, 0)
        await page.keyboard.type('- ')
        await waitForSettle(page)
        const joined = await page.evaluate(() => [
          document.querySelectorAll('.sky-wysiwyg > ul').length,
          document.querySelectorAll('.sky-wysiwyg > ul > li').length,
        ])
        await placeCaret(page, `${ROOT} li:last-child p.end-block`, 4)
        await page.keyboard.press('Shift+Enter')
        await page.keyboard.type('3) three')
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: '"- " before a paragraph that follows a dash list, then "3) three" on a new line inside the item',
          should: 'append to the existing list, and start a nested ordered list at 3',
          actual: [joined, await readMarkdownFromDisk(file)],
          expected: [[1, 2], '- one\n\n- next\n  3) three\n'],
        })
      },
    )
  },
)

test({ name: 'TYP-10 TYP-11 a quote marker and a task mark convert in place', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-typ-10-', initialMarkdown: 'quoted\n\n- item\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await placeCaret(page, `${ROOT} > p.end-block`, 0)
      await page.keyboard.type('> ')
      await waitForSettle(page)
      const quote = await page.evaluate(
        () => document.querySelector('.sky-wysiwyg > blockquote > p.end-block')?.textContent ?? null,
      )
      await placeCaret(page, `${ROOT} li p.end-block`, 0)
      await page.keyboard.type('[x] ')
      await waitForSettle(page)
      const task = await page.evaluate(() => [
        document.querySelector('li.task.done input[type="checkbox"]') !== null,
        document.querySelector('li.task p.end-block')?.textContent,
      ])
      await waitForAutosave(page)
      assert({
        given: '"> " at a paragraph start and "[x] " at an item start',
        should: 'make a quote and a checked task, and save both',
        actual: [quote, task, await readMarkdownFromDisk(file)],
        expected: ['quoted', [true, 'item'], '> quoted\n\n- [x] item\n'],
      })
    },
  )
})

test({ name: 'TYP-13 a marker completed on a later line splits the paragraph there', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-typ-13-', initialMarkdown: 'alpha\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await placeCaret(page, P, 5)
      await page.keyboard.press('Shift+Enter')
      await page.keyboard.type('- beta')
      await waitForSettle(page)
      const caret = await caretOffset(page)
      await waitForAutosave(page)
      assert({
        given: 'a soft break then "- beta" typed on the second line',
        should: 'keep alpha as a paragraph, make beta a list item, and put the caret after beta',
        actual: [
          await page.evaluate(() => [...document.querySelectorAll('.sky-wysiwyg > *')].map((el) => el.tagName)),
          caret.offset,
          await readMarkdownFromDisk(file),
        ],
        expected: [['P', 'UL'], 4, 'alpha\n- beta\n'],
      })
    },
  )
})

test(
  { name: 'TYP-14 TYP-18 TYP-15 a heading marker previews, then commits as content is typed', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-typ-14-', initialMarkdown: 'text\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, P, 0)
        await page.keyboard.type('## ')
        await waitForSettle(page)
        const preview = await page.evaluate(() => {
          const p = document.querySelector('p.end-block')
          return [p?.getAttribute('data-looks-like'), p?.querySelector('.block-syntax')?.textContent, p?.textContent]
        })
        await page.keyboard.type('T')
        await waitForSettle(page)
        const committed = await page.evaluate(() => [
          document.querySelector('.sky-wysiwyg > h2.end-block')?.textContent ?? null,
          document.querySelectorAll('.sky-wysiwyg > p').length,
        ])
        const caret = await caretOffset(page)
        await waitForAutosave(page)
        assert({
          given: '"## " typed at a paragraph start, then a letter',
          should:
            'preview a level-2 heading with a muted marker, then commit to a heading with the caret after the letter',
          actual: [preview, committed, caret.offset, await readMarkdownFromDisk(file)],
          expected: [['h2', '## ', '## text'], ['Ttext', 0], 1, '## Ttext\n'],
        })
      },
    )
  },
)

test(
  {
    name: 'TYP-15 TYP-16 previews commit when focus leaves the block; a broken marker stays a paragraph',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-typ-15-', initialMarkdown: 'one\n\ntwo\n\nthree\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        const block = (n: number) => `${ROOT} > .end-block:nth-child(${n})`
        await placeCaret(page, block(1), 3)
        await page.keyboard.press('Shift+Enter')
        await page.keyboard.type('===')
        await placeCaret(page, block(2), 0)
        await waitForSettle(page)
        await page.keyboard.type('```js')
        await page.keyboard.press('Shift+Enter')
        await placeCaret(page, block(3), 0)
        await waitForSettle(page)
        await page.keyboard.type('#nope ')
        await placeCaret(page, block(1), 0)
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: 'a setext underline, a fence opener and a bare #tag, each left by moving the caret away',
          should: 'commit the heading and the fence and leave the tagged paragraph alone',
          actual: [
            await page.evaluate(() => [...document.querySelectorAll('.sky-wysiwyg > *')].map((el) => el.tagName)),
            await readMarkdownFromDisk(file),
          ],
          expected: [['H1', 'PRE', 'P'], 'one\n===\n\n```js\ntwo\n```\n\n#nope three\n'],
        })
      },
    )
  },
)
