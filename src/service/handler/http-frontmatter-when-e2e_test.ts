import { assert, test } from '#test'
import {
  openEditor,
  placeCaret,
  readMarkdownFromDisk,
  runWysiwygE2e,
  waitForAutosave,
} from './httpWysiwygE2eTestHelpers.ts'

for (const [notation, value] of [
  ['duration', '2031-03-16 09:10 165m'],
  ['range', '2031-03-16 09:10 - 11:55'],
]) {
  test(
    { name: `when field preserves ${notation} notation through reading, editing and saving`, timeout: 40000 },
    async (t) => {
      const initial = `---\nwhen: ${value}\ntype: Notes\n---\n\n# Atlas note\n\nHello\n`
      await runWysiwygE2e(
        t,
        { initialMarkdown: initial, tempPrefix: `sky-when-${notation}-` },
        async ({ page, origin, file, errors }) => {
          // The field must work in browsers that do not provide Temporal, too.
          await page.addInitScript(() => {
            Object.defineProperty(globalThis, 'Temporal', { value: undefined, configurable: true })
          })
          const url = `${origin}/explorer/notes/preview.md`
          const row = page.locator('.sky-identity .sky-prop[data-key="when"]')
          const hint = row.locator('.sky-prop-hint')
          await page.goto(url)
          await hint.waitFor()
          assert({
            given: `a dated ${notation} in a browser without Temporal`,
            should: 'show its duration without marking the source invalid or changing the file',
            actual: [await hint.innerText(), await row.locator('.bad').count(), await readMarkdownFromDisk(file)],
            expected: ['Sun · 2 h 45 min', 0, initial],
          })

          await openEditor(page, origin)
          const input = row.locator('input')
          assert({
            given: 'the same field opened for editing',
            should: 'retain its complete source value and the readable duration',
            actual: [await input.inputValue(), await hint.innerText()],
            expected: [value, 'Sun · 2 h 45 min'],
          })
          await input.fill(`${value} invalid`)
          await row.locator('.bad').waitFor()
          await input.fill(value)
          await row.locator('.bad').waitFor({ state: 'detached' })
          await placeCaret(page, '.sky-wysiwyg p', 5)
          await page.keyboard.insertText(' again')
          await waitForAutosave(page)
          const saved = await readMarkdownFromDisk(file)
          await page.goto(url)
          await hint.waitFor()
          assert({
            given: 'a corrected draft and an unrelated body edit followed by a reload',
            should: 'clear the validation warning and preserve the chosen time notation through autosave',
            actual: [
              saved.match(/^when:.*$/m)?.[0],
              saved.includes('Hello again'),
              await hint.innerText(),
              await row.locator('.bad').count(),
              await page.title(),
              errors,
            ],
            expected: [`when: ${value}`, true, 'Sun · 2 h 45 min', 0, 'sky · preview', []],
          })
        },
      )
    },
  )
}
