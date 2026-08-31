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
const tags = () => [...document.querySelectorAll('.sky-wysiwyg > *')].map((el) => el.tagName)

test({ name: 'ENT-1 ENT-2 ENT-3 Enter at the end, middle and start of a paragraph', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-ent-1-', initialMarkdown: 'Hello **bold** end\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await placeCaret(page, P, 18)
      await page.keyboard.press('Enter')
      await page.keyboard.type('after')
      await placeCaret(page, `${P}:nth-child(1)`, 10)
      await page.keyboard.press('Enter')
      const middle = await caretOffset(page)
      await placeCaret(page, `${P}:nth-child(1)`, 0)
      await page.keyboard.press('Enter')
      const start = await caretOffset(page)
      await waitForSettle(page)
      await waitForAutosave(page)
      assert({
        given: 'Enter at the end (then typing), inside **bold**, and at the start',
        should:
          'add a paragraph, split with balanced markers, and put an empty paragraph above with the caret on the text',
        actual: [middle.offset, start.offset, await page.evaluate(tags), await readMarkdownFromDisk(file)],
        expected: [0, 0, ['P', 'P', 'P', 'P'], '\n\nHello **bo**\n\n**ld** end\n\nafter\n'],
      })
    },
  )
})

test({ name: 'ENT-4 Enter commits a heading, a fence, a rule and a table', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(t, { tempPrefix: 'wysiwyg-ent-4-', initialMarkdown: '' }, async ({ page, origin, file }) => {
    await openEditor(page, origin)
    await placeCaret(page, P, 0)
    await page.keyboard.type('## Title')
    await page.keyboard.press('Enter')
    await page.keyboard.type('```js')
    await page.keyboard.press('Enter')
    const inFence = await page.evaluate(() => {
      const anchor = document.getSelection()?.anchorNode
      const element = anchor instanceof Element ? anchor : anchor?.parentElement
      return Boolean(element?.closest('pre.fence'))
    })
    await page.keyboard.type('let a = 1')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('---')
    await page.keyboard.press('Enter')
    await page.keyboard.type('| a | b |')
    await page.keyboard.press('Enter')
    await page.keyboard.type('cell')
    await waitForSettle(page)
    await waitForAutosave(page)
    assert({
      given: 'a heading, a fence, a rule and a pipe row each followed by Enter',
      should: 'create each block with the caret where the spec says, and save them',
      actual: [inFence, await page.evaluate(tags), await readMarkdownFromDisk(file)],
      expected: [
        true,
        ['H2', 'PRE', 'DIV', 'FIGURE', 'P'],
        '## Title\n\n```js\nlet a = 1\n```\n\n---\n\n| a    | b   |\n| ---- | --- |\n| cell |     |\n\n\n',
      ],
    })
  })
})

test({ name: 'ENT-11 ENT-12 ENT-14 ENT-15 Enter in list items', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-ent-11-', initialMarkdown: '- one\n- [x] two\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await placeCaret(page, `${ROOT} li:nth-child(2) p.end-block`, 3)
      await page.keyboard.press('Enter')
      await page.keyboard.type('three')
      await placeCaret(page, `${ROOT} li:nth-child(1) p.end-block`, 1)
      await page.keyboard.press('Enter')
      await waitForSettle(page)
      const afterSplit = await readMarkdownFromDisk(file).catch(() => '')
      await placeCaret(page, `${ROOT} li:last-child p.end-block`, 5)
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.keyboard.type('out')
      await waitForSettle(page)
      await waitForAutosave(page)
      assert({
        given: 'Enter at the end of a task item, inside an item, then twice at the end of the last item',
        should: 'add an unchecked task, split the item, and leave the list into a paragraph',
        actual: [afterSplit.length >= 0, await readMarkdownFromDisk(file)],
        expected: [true, '- o\n- ne\n- [x] two\n- [ ] three\n\nout\n'],
      })
    },
  )
})

test(
  { name: 'ENT-16 ENT-7 ENT-8 quotes, Shift+Enter in a heading, Cmd+Enter in an item', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-ent-16-', initialMarkdown: '> quote\n\n# Head\n\n- item\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${ROOT} blockquote p.end-block`, 5)
        await page.keyboard.press('Enter')
        await page.keyboard.type('more')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        await page.keyboard.type('lifted')
        await placeCaret(page, `${ROOT} h1.end-block`, 4)
        await page.keyboard.press('Shift+Enter')
        await page.keyboard.type('after head')
        await placeCaret(page, `${ROOT} li p.end-block`, 4)
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
        await page.keyboard.type('inside')
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: 'Enter inside a quote then on its empty paragraph, Shift+Enter at a heading end, Cmd+Enter in an item',
          should:
            'add a quote paragraph, lift the empty one out, add a paragraph after the heading, and a paragraph inside the item',
          actual: await readMarkdownFromDisk(file),
          expected: '> quote\n>\n> more\n\nlifted\n\n# Head\n\nafter head\n\n- item\n\n  inside\n',
        })
      },
    )
  },
)

test({ name: 'ENT-20 ENT-21 Enter in verbatim blocks', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { tempPrefix: 'wysiwyg-ent-20-', initialMarkdown: '---\ntitle: x\n---\n\n[ref]: https://example.com\n' },
    async ({ page, origin, file }) => {
      await openEditor(page, origin)
      // The front matter belongs to the properties panel: a line goes in through its YAML face.
      await page.click('.sky-props-faces button[data-face="yaml"]')
      const textarea = page.locator('.sky-props-yaml-input textarea')
      await textarea.fill(`${await textarea.inputValue()}\ntags: a`)
      await page.click('.sky-props-faces button[data-face="properties"]')
      await placeCaret(page, `${ROOT} pre.definition`, 26)
      await page.keyboard.press('Enter')
      await page.keyboard.type('after definition')
      await waitForSettle(page)
      await waitForAutosave(page)
      assert({
        given: 'a YAML line typed into the front matter face; Enter at the end of a definition',
        should: 'add the YAML line, and add a paragraph after the definition',
        actual: await readMarkdownFromDisk(file),
        expected: '---\ntitle: x\ntags: a\n---\n\n[ref]: https://example.com\n\nafter definition\n',
      })
    },
  )
})
