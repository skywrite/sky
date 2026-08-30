import { assert, test } from '#test'
import {
  dispatchClipboard,
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
const tags = () => [...document.querySelectorAll('.sky-wysiwyg > *')].map((el) => el.tagName)

test(
  {
    name: 'CLP-1 CLP-2 CLP-14 CLP-6 copy across blocks gives markdown, html and our marker; it pastes back with its structure; cut removes',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-clp-1-', initialMarkdown: 'one **two**\n\n- item\n\nlast\n\ntarget\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${P}:nth-child(1)`, 4)
        for (let i = 0; i < 16; i++) await page.keyboard.press('Shift+ArrowRight')
        const copied = await dispatchClipboard(page, 'copy')
        await placeCaret(page, `${ROOT} > p.end-block:last-child`, 6)
        await dispatchClipboard(page, 'paste', copied)
        await waitForSettle(page)
        const structure = await page.evaluate(tags)
        await placeCaret(page, `${P}:nth-child(1)`, 0)
        for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
        const cutData = await dispatchClipboard(page, 'cut')
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given:
            'a selection from inside the first paragraph into the third, copied, pasted at the end, then a cut of "one"',
          should: 'carry markdown, html and the marker; rebuild the list on paste; remove the cut text',
          actual: [
            copied['text/plain'],
            copied['text/html'],
            copied['application/x-sky-markdown'] === copied['text/plain'],
            structure,
            cutData['text/plain'],
            await readMarkdownFromDisk(file),
          ],
          expected: [
            '**two**\n\n- item\n\nlas\n',
            '<p><strong>two</strong></p>\n<ul><li>item</li></ul>\n<p>las</p>',
            true,
            ['P', 'UL', 'P', 'P', 'UL', 'P'],
            'one',
            ' **two**\n\n- item\n\nlast\n\ntarget**two**\n\n- item\n\nlas\n',
          ],
        })
      },
    )
  },
)

test(
  {
    name: 'CLP-7 CLP-8 CLP-17 CLP-19 plain text pastes inline or as blocks, URLs link after settle, one undo step',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-clp-7-', initialMarkdown: 'ab\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, P, 1)
        await dispatchClipboard(page, 'paste', { 'text/plain': 'X' })
        const inline = await page.evaluate(() => document.querySelector('p.end-block')?.textContent)
        await dispatchClipboard(page, 'paste', { 'text/plain': ' https://example.com ' })
        await waitForSettle(page)
        const linked = await page.evaluate(() => document.querySelectorAll('p.end-block a').length)
        await placeCaret(page, P, 2)
        await dispatchClipboard(page, 'paste', { 'text/plain': 'first\n\n# Head\n\n- one\n- two' })
        await waitForSettle(page)
        const blocks = await page.evaluate(tags)
        await page.keyboard.press(modShortcut('z'))
        await waitForSettle(page)
        const undone = await page.evaluate(tags)
        await waitForAutosave(page)
        assert({
          given: 'a word pasted, a URL pasted, several lines pasted mid-paragraph, then undo',
          should:
            'insert the word, autolink the URL, make blocks with the tail re-attached, and undo the paste as one step',
          actual: [inline, linked, blocks, undone, await readMarkdownFromDisk(file)],
          expected: ['aXb', 1, ['P', 'H1', 'UL'], ['P'], 'aX https://example.com b\n'],
        })
      },
    )
  },
)

test(
  { name: 'CLP-10 CLP-11 pasting into a fence stays literal; into an item splices items', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { tempPrefix: 'wysiwyg-clp-10-', initialMarkdown: '```\ncode\n```\n\n- one\n- two\n' },
      async ({ page, origin, file }) => {
        await openEditor(page, origin)
        await placeCaret(page, `${ROOT} pre.fence`, 4)
        await dispatchClipboard(page, 'paste', { 'text/plain': '\n# not a heading' })
        await placeCaret(page, `${ROOT} li:first-child p.end-block`, 3)
        await dispatchClipboard(page, 'paste', { 'text/plain': '- x\n- y' })
        await waitForSettle(page)
        await waitForAutosave(page)
        assert({
          given: 'a heading-looking line pasted into a fence, and two items pasted into the first item',
          should: 'keep the fence text literal and add the items to the list',
          actual: [await page.evaluate(tags), await readMarkdownFromDisk(file)],
          expected: [['PRE', 'UL'], '```\ncode\n# not a heading\n```\n\n- one\n- x\n- y\n- two\n'],
        })
      },
    )
  },
)

test(
  {
    name: 'CLP-12 CLP-13 CLP-15 HTML from other apps converts; markdown-looking HTML text stays text; Cmd+Shift+V takes the text',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(t, { tempPrefix: 'wysiwyg-clp-12-', initialMarkdown: '' }, async ({ page, origin, file }) => {
      await openEditor(page, origin)
      await placeCaret(page, P, 0)
      await dispatchClipboard(page, 'paste', {
        'text/html':
          '<meta charset="utf-8"><h2>Title</h2><p>a <b>bold</b> and <span style="font-style:italic">it</span> <a href="https://x.y">link</a></p><ul><li>one<ul><li>sub</li></ul></li><li><input type="checkbox" checked> done</li></ul><table><tr><th>h1</th><th align="right">h2</th></tr><tr><td>c1</td><td>c2</td></tr></table><pre><code class="language-js">let a = 1</code></pre>',
        'text/plain': 'Title\na bold and it link\none\nsub\ndone\nh1 h2\nc1 c2\nlet a = 1',
      })
      await waitForSettle(page)
      await waitForAutosave(page)
      const converted = await readMarkdownFromDisk(file)
      await dispatchClipboard(page, 'paste', {
        'text/html': '<p># Not html</p><p>- item</p>',
        'text/plain': '# Not html\n- item',
      })
      await waitForSettle(page)
      await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+KeyV`)
      await dispatchClipboard(page, 'paste', { 'text/html': '<p><b>rich</b></p>', 'text/plain': 'plain' })
      await waitForSettle(page)
      await waitForAutosave(page)
      assert({
        given: 'rich HTML, HTML whose text is markdown, and a paste after Cmd+Shift+V',
        should:
          'convert headings, styles, links, nested and task lists, tables and code; keep markdown text; take the plain text',
        actual: [converted, await readMarkdownFromDisk(file)],
        expected: [
          '## Title\n\na **bold** and *it* [link](https://x.y)\n\n- one\n  - sub\n- [x] done\n\n| h1 | h2 |\n| --- | --: |\n| c1 | c2 |\n\n```js\nlet a = 1\n```\n',
          '## Title\n\na **bold** and *it* [link](https://x.y)\n\n- one\n  - sub\n- [x] done\n\n| h1 | h2 |\n| --- | --: |\n| c1 | c2 |\n\n```js\nlet a = 1# Not html\n- itemplain\n```\n',
        ],
      })
    })
  },
)
