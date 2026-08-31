// The front matter as an identity line under the title and a rail beside the document: typed
// rows in both views, chips with completion from the notebook, what links here, the outline, the
// raw YAML behind a switch; every change one undo step on the document.

import { assert, test } from '#test'
import {
  modShortcut,
  openEditor,
  placeCaret,
  readMarkdownFromDisk,
  runWysiwygE2e,
  waitForAutosave,
  waitForSettle,
} from './httpWysiwygE2eTestHelpers.ts'

const FRONT = `---
when: 2026-08-05 10:15 - 11:25
who: Jane Doe
medium: meeting
tags: atlas; planning
rel:
  - Jane Doe
attachments:
  - { file: "report.pdf" }
---
`
const DOC = `${FRONT}\n# Atlas sync\n\nHello\n\n## Decisions\n\nLaunch in September.\n`
const PEOPLE = {
  'people/Jane-Doe.md': '---\nname: Jane Doe\norg: Acme\ntitle: Head of Ops\n---\n\nRuns operations.\n',
  'people/Jamal-Reyes.md': '---\nname: Jamal Reyes\norg: Atlas\n---\n',
}

test(
  { name: 'rail — a document reads with its identity under the title and the rest in the rail', timeout: 40000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: DOC, tempPrefix: 'wysiwyg-rail-read-', files: PEOPLE, store: true },
      async ({ page, origin, errors }) => {
        await page.setViewportSize({ width: 1400, height: 900 })
        await page.goto(`${origin}/explorer/notes/preview.md`)
        await page.waitForSelector('.sky-identity[data-readonly]')
        await page.waitForSelector('.sky-identity .sky-prop[data-key="who"] a.sky-prop-chip.link')
        await page.waitForSelector('.sky-rail .sky-rail-sec[data-section="outline"] li')
        const identity = await page.evaluate(() =>
          [...document.querySelectorAll('.sky-identity .sky-prop')].map((row) => row.getAttribute('data-key')),
        )
        const sections = await page.evaluate(() =>
          [...document.querySelectorAll('.sky-rail .sky-rail-sec')].map((section) =>
            section.getAttribute('data-section'),
          ),
        )
        const railRows = await page.evaluate(() =>
          [...document.querySelectorAll('.sky-rail .sky-prop')].map((row) => row.getAttribute('data-key')),
        )
        const who = await page.getAttribute('.sky-identity .sky-prop[data-key="who"] a.sky-prop-chip.link', 'href')
        const file = await page.getAttribute('.sky-rail .sky-prop[data-key="attachments"] a.sky-prop-chip.file', 'href')
        const hint = await page.textContent('.sky-identity .sky-prop[data-key="when"] .sky-prop-hint')
        const outline = await page.evaluate(() =>
          [...document.querySelectorAll('.sky-rail .sky-outline li')].map((li) => [
            li.className,
            li.textContent?.trim(),
          ]),
        )
        const inlinePanel = await page.evaluate(
          () => document.querySelector('.sky-props, details.sky-doc-meta') !== null,
        )
        await page.click('.sky-rail .sky-props-faces button[data-face="yaml"]')
        const yaml = await page.textContent('.sky-rail pre.sky-props-yaml')
        assert({
          given: 'a day capture opened to read on a wide screen, with a person the notebook knows',
          should:
            'put when/who/medium under the title, tags/links/files/document in the rail with the outline, link the person and the file, read the range, and keep the YAML behind the switch',
          actual: [
            identity,
            sections,
            railRows,
            who,
            file,
            hint,
            outline,
            inlinePanel,
            yaml?.includes('who: Jane Doe'),
            errors,
          ],
          expected: [
            ['when', 'who', 'medium'],
            ['tags', 'links', 'files', 'outline', 'document'],
            ['tags', 'rel', 'attachments', 'path'],
            '/explorer/people/Jane-Doe.md',
            '/docs/_api/file/notes/report.pdf',
            'Wed · 1 h 10 min',
            [
              ['l1 on', 'Atlas sync'],
              ['l2', 'Decisions'],
            ],
            false,
            true,
            [],
          ],
        })
      },
    )
  },
)

test({ name: 'rail — linked from lists the captures that name a person, newest first', timeout: 40000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { initialMarkdown: DOC, tempPrefix: 'wysiwyg-rail-back-', file: 'library/preview.md', files: PEOPLE, store: true },
    async ({ page, origin, errors }) => {
      await page.setViewportSize({ width: 1400, height: 900 })
      await page.goto(`${origin}/explorer/people/Jane-Doe.md`)
      await page.waitForSelector('.sky-rail .sky-rail-sec[data-section="linked-from"] a.sky-backlink')
      const backlinks = await page.evaluate(() =>
        [...document.querySelectorAll('.sky-rail a.sky-backlink')].map((a) => [
          a.getAttribute('href'),
          a.querySelector('.sky-backlink-label')?.textContent,
        ]),
      )
      const identity = await page.evaluate(() =>
        [...document.querySelectorAll('.sky-identity .sky-prop')].map((row) => row.getAttribute('data-key')),
      )
      assert({
        given: "a person's page, named in a capture's who and rel",
        should: 'list the capture under Linked from, with name, org and title on the identity line',
        actual: [backlinks, identity, errors],
        expected: [[['/explorer/library/preview.md', 'preview']], ['name', 'org', 'title'], []],
      })
    },
  )
})

test(
  {
    name: 'rail — chips complete from the notebook in both places, write the shapes, and undo as one step',
    timeout: 40000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: DOC, tempPrefix: 'wysiwyg-rail-edit-', files: PEOPLE, store: true },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width: 1400, height: 900 })
        await openEditor(page, origin)
        await page.waitForSelector('.sky-identity:not([data-readonly])')
        const hiddenBlock = await page.evaluate(() => document.querySelector('.sky-wysiwyg pre.frontmatter') === null)
        await page.click('.sky-identity .sky-prop[data-key="who"] input')
        await page.keyboard.type('jam')
        await page.getByRole('option', { name: /Jamal Reyes/ }).waitFor()
        const optionHeight = await page.evaluate(
          () => document.querySelector('[role="option"]')?.getBoundingClientRect().height ?? 0,
        )
        await page.keyboard.press('Enter')
        await waitForAutosave(page)
        const withPerson = await readMarkdownFromDisk(file)
        await page.click('.sky-rail .sky-prop[data-key="tags"] input')
        await page.keyboard.type('q3')
        await page.keyboard.press('Enter')
        await waitForAutosave(page)
        const withTag = await readMarkdownFromDisk(file)
        await placeCaret(page, '.sky-wysiwyg h1', 0)
        await page.keyboard.press('ArrowUp')
        const upIntoIdentity = await page.evaluate(() => document.activeElement?.closest('.sky-identity') !== null)
        await placeCaret(page, '.sky-wysiwyg h1', 0)
        await page.keyboard.press('Backspace')
        await page.keyboard.press(modShortcut('z'))
        await waitForSettle(page)
        await waitForAutosave(page)
        const undone = await readMarkdownFromDisk(file)
        assert({
          given:
            'a person picked on the identity line, a tag typed in the rail, Up from the start of the body, Backspace there and one undo',
          should:
            'write people on one line and tags on one, take Up into the identity line, leave the body alone, and undo the tag',
          actual: [hiddenBlock, optionHeight < 44, upIntoIdentity, withPerson, withTag, undone, errors],
          expected: [
            true,
            true,
            true,
            DOC.replace('who: Jane Doe', 'who: Jane Doe, Jamal Reyes'),
            DOC.replace('who: Jane Doe', 'who: Jane Doe, Jamal Reyes').replace(
              'tags: atlas; planning',
              'tags: atlas; planning; q3',
            ),
            DOC.replace('who: Jane Doe', 'who: Jane Doe, Jamal Reyes'),
            [],
          ],
        })
      },
    )
  },
)

test(
  { name: 'rail — add a property, pick a value, remove a key, and edit the YAML face', timeout: 40000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: DOC, tempPrefix: 'wysiwyg-rail-keys-', files: PEOPLE, store: true },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width: 1400, height: 900 })
        await openEditor(page, origin)
        await page.waitForSelector('.sky-rail:not([data-readonly])')
        await page.click('.sky-rail .sky-props-add input')
        await page.keyboard.type('where')
        await page.keyboard.press('Enter')
        await page.waitForSelector('.sky-identity .sky-prop[data-key="where"] input')
        await page.keyboard.type('Lisbon')
        await page.keyboard.press('Enter')
        await waitForAutosave(page)
        const added = await readMarkdownFromDisk(file)
        await page.click('.sky-identity button[aria-label="Remove medium"]')
        await waitForAutosave(page)
        const removed = await readMarkdownFromDisk(file)
        await page.click('.sky-rail .sky-props-faces button[data-face="yaml"]')
        const textarea = page.locator('.sky-rail .sky-props-yaml-input textarea')
        await textarea.fill(`${await textarea.inputValue()}\nsummary: Quick sync`)
        await page.click('.sky-rail .sky-props-faces button[data-face="properties"]')
        await waitForAutosave(page)
        const yamlEdited = await readMarkdownFromDisk(file)
        const summaryHome = await page.evaluate(
          () => document.querySelector('.sky-identity-below .sky-prop[data-key="summary"]') !== null,
        )
        assert({
          given:
            'a property added from the rail and filled on the identity line, a key removed, and a line typed into the YAML face',
          should:
            'append the key, drop the key, take the line as written, and show the summary under the identity line',
          actual: [added, removed, yamlEdited, summaryHome, errors],
          expected: [
            DOC.replace('  - { file: "report.pdf" }\n', '  - { file: "report.pdf" }\nwhere: Lisbon\n'),
            DOC.replace('medium: meeting\n', '').replace(
              '  - { file: "report.pdf" }\n',
              '  - { file: "report.pdf" }\nwhere: Lisbon\n',
            ),
            DOC.replace('medium: meeting\n', '').replace(
              '  - { file: "report.pdf" }\n',
              '  - { file: "report.pdf" }\nwhere: Lisbon\nsummary: Quick sync\n',
            ),
            true,
            [],
          ],
        })
      },
    )
  },
)

test(
  {
    name: 'rail — narrow screens get the rail as an overlay from Details; a phone never scrolls sideways',
    timeout: 40000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: DOC, tempPrefix: 'wysiwyg-rail-narrow-', files: PEOPLE, store: true },
      async ({ page, origin, errors }) => {
        await page.setViewportSize({ width: 1000, height: 800 })
        await page.goto(`${origin}/explorer/notes/preview.md`)
        await page.waitForSelector('.sky-identity[data-readonly]')
        const hiddenAtFirst = await page.evaluate(() => document.querySelector('.sky-rail') === null)
        await page.getByRole('button', { name: 'Details', exact: true }).click()
        await page.waitForSelector('.sky-rail')
        const overlay = await page.evaluate(() => {
          const rail = document.querySelector('.sky-rail')!
          const box = rail.getBoundingClientRect()
          return getComputedStyle(rail).position === 'absolute' && box.right <= document.documentElement.clientWidth
        })
        await page.keyboard.press('Escape')
        await page.waitForSelector('.sky-rail', { state: 'detached' })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByRole('button', { name: 'Details', exact: true }).click()
        await page.waitForSelector('.sky-rail')
        const phone = await page.evaluate(() => {
          const root = document.documentElement
          const rail = document.querySelector('.sky-rail')!.getBoundingClientRect()
          return {
            overflow: root.scrollWidth > root.clientWidth,
            railFits: rail.left >= 0 && rail.right <= root.clientWidth,
          }
        })
        await page.click('.sky-rail-close')
        await page.waitForSelector('.sky-rail', { state: 'detached' })
        await openEditor(page, origin)
        const phoneEdit = await page.evaluate(() => {
          const root = document.documentElement
          const key = document
            .querySelector('.sky-identity .sky-prop[data-key="who"] .sky-prop-key')
            ?.getBoundingClientRect()
          const value = document
            .querySelector('.sky-identity .sky-prop[data-key="who"] .sky-prop-value')
            ?.getBoundingClientRect()
          return {
            overflow: root.scrollWidth > root.clientWidth,
            stacked: key !== undefined && value !== undefined && value.top >= key.top + key.height - 1,
          }
        })
        assert({
          given: 'a 1000px window, then a 390px one, reading and editing',
          should:
            'hide the rail until Details, show it as an overlay that Esc closes, fit the phone, and stack the identity fields',
          actual: [hiddenAtFirst, overlay, phone, phoneEdit, errors],
          expected: [true, true, { overflow: false, railFits: true }, { overflow: false, stacked: true }, []],
        })
      },
    )
  },
)
