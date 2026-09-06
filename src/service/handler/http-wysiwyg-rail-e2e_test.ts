// The front matter as an identity line under the title and a rail beside the document: typed
// rows in both views, chips with completion from the notebook, what links here, the outline, the
// raw YAML behind a switch; every change one undo step on the document.

import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { exists } from '#shared/fs/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
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
const DAY = new PlainDate('2026-08-05')
const DAY_DOC = path.posix.join('time', dayDir(DAY), 'meeting_atlas-sync.md')
const PEOPLE = {
  'people/Jane-Doe.md': '---\nname: Jane Doe\norg: Acme\ntitle: Head of Ops\n---\n\nRuns operations.\n',
  'people/Jamal-Reyes.md':
    '---\nname: Jamal Reyes\norg: Atlas\ntitle: Head of Product Partnerships and Customer Strategy\n---\n',
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
          actual: [hiddenBlock, optionHeight <= 64, upIntoIdentity, withPerson, withTag, undone, errors],
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

test({ name: 'rail — projects/ completes a project in Links and saves a working link', timeout: 40000 }, async (t) => {
  const projectPath = 'projects/open/Widget-V2/_project/overview.md'
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: DOC,
      tempPrefix: 'wysiwyg-rail-project-',
      files: {
        ...PEOPLE,
        [projectPath]: '---\nname: Team Survey\nstatus: open\n---\n',
        'projects/completed/2025/Atlas/_project/overview.md': '---\nname: Atlas\nstatus: completed\n---\n',
        'projects/hold/Held-Atlas/_project/overview.md': '---\nname: Held Atlas\nstatus: hold\n---\n',
        'projects/open/.Hidden-Atlas/_project/overview.md': '---\nname: Hidden Atlas\nstatus: open\n---\n',
      },
      store: true,
    },
    async ({ page, origin, file, errors }) => {
      await page.setViewportSize({ width: 1400, height: 900 })
      await openEditor(page, origin)
      const input = page.locator('.sky-rail .sky-prop[data-key="rel"] input')
      await input.fill('projects/')
      await page.getByRole('option', { name: /Widget-V2/ }).waitFor()
      const offered = await page.getByRole('option').locator('.sky-prop-option-label').allTextContents()
      await input.fill('projects/widget')
      await page.getByRole('option', { name: /Widget-V2/ }).waitFor()
      await input.press('Enter')
      await waitForAutosave(page)
      const saved = await readMarkdownFromDisk(file)
      await page.goto(`${origin}/explorer/notes/preview.md`)
      const link = page.locator('.sky-rail .sky-prop[data-key="rel"] a').filter({ hasText: 'projects/Widget-V2' })
      await link.waitFor()
      assert({
        given: 'projects/ followed by a partial project name in Links, selected with Enter',
        should: 'offer only the visible open folder, save projects/Folder, and link to its overview after reload',
        actual: [offered, saved, await link.getAttribute('href'), errors],
        expected: [
          ['Widget-V2'],
          DOC.replace('  - Jane Doe\n', '  - Jane Doe\n  - projects/Widget-V2\n'),
          `/explorer/${projectPath}`,
          [],
        ],
      })
    },
  )
})

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
    name: 'rail — narrow screens get the rail as an overlay from the chevron; a phone never scrolls sideways',
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
        await page.getByRole('button', { name: 'Show details', exact: true }).click()
        await page.waitForSelector('.sky-rail')
        const overlay = await page.evaluate(() => {
          const rail = document.querySelector('.sky-rail')!
          const box = rail.getBoundingClientRect()
          return getComputedStyle(rail).position === 'absolute' && box.right <= document.documentElement.clientWidth
        })
        await page.keyboard.press('Escape')
        await page.waitForSelector('.sky-rail', { state: 'detached' })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByRole('button', { name: 'Show details', exact: true }).click()
        await page.waitForSelector('.sky-rail')
        const phone = await page.evaluate(() => {
          const root = document.documentElement
          const rail = document.querySelector('.sky-rail')!.getBoundingClientRect()
          return {
            overflow: root.scrollWidth > root.clientWidth,
            railFits: rail.left >= 0 && rail.right <= root.clientWidth,
          }
        })
        await page.getByRole('button', { name: 'Hide details', exact: true }).click()
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
            'hide the rail until Show details, show it as an overlay that Esc closes, fit the phone, and stack the identity fields',
          actual: [hiddenAtFirst, overlay, phone, phoneEdit, errors],
          expected: [true, true, { overflow: false, railFits: true }, { overflow: false, stacked: true }, []],
        })
      },
    )
  },
)

test(
  {
    name: 'rail — files join the list from the dialog: brought in from this Mac, picked from beside the document, copied, unlisted',
    timeout: 40000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: DOC, tempPrefix: 'wysiwyg-rail-files-', file: DAY_DOC, files: PEOPLE, store: true, day: true },
      async ({ page, origin, file, relativePath, userDataDir, downloads, errors }) => {
        await page.setViewportSize({ width: 1400, height: 900 })
        await openEditor(page, origin, relativePath)
        await page.waitForSelector('.sky-rail:not([data-readonly]) .sky-rail-pad')
        const chip = (name: string) =>
          `.sky-rail .sky-prop[data-key="attachments"] a.sky-prop-chip.file[href$="/${name}"]`
        const dialogRows = async () => {
          await page.click('.sky-rail-choose')
          await page.waitForSelector('.sky-attach-dialog .sky-attach-row')
          return await page.evaluate(() =>
            [...document.querySelectorAll('.sky-attach-row')].map((row) => [
              row.querySelector('.sky-attach-name')?.textContent,
              row.hasAttribute('data-listed'),
            ]),
          )
        }
        // A file the day holds that the document does not list yet.
        const dayFilesDir = path.join(userDataDir, 'attachments', dayAttachmentsDir(DAY))
        await mkdir(dayFilesDir, { recursive: true })
        await writeFile(path.join(dayFilesDir, 'chart.png'), 'PNG bytes')
        const rowsBefore = await dialogRows()
        // Brought in from this Mac: a real file, so the browser reports its modified time and the look finds it.
        const original = path.join(downloads, 'deck.pdf')
        await writeFile(original, '%PDF-1.4 deck')
        await page.setInputFiles('.sky-attach-dialog input[type="file"]', original)
        await page.waitForSelector(chip('deck.pdf'))
        const note = await page.textContent('.sky-rail-note span')
        const undoOffered = await page.isVisible('.sky-rail-undo')
        await waitForAutosave(page)
        const afterMove = await readMarkdownFromDisk(file)
        const movedOut = !(await exists(original))
        // Picked from beside the document: the one the day held all along.
        const rowsAfter = await dialogRows()
        await page.click('.sky-attach-row:not([data-listed]) input[type="checkbox"]')
        await page.getByRole('button', { name: 'Add', exact: true }).click()
        await page.waitForSelector(chip('chart.png'))
        const pickNote = await page.textContent('.sky-rail-note span')
        await waitForAutosave(page)
        const afterPick = await readMarkdownFromDisk(file)
        // Bytes with no original anywhere land as a copy.
        await page.click('.sky-rail-choose')
        await page.waitForSelector('.sky-attach-dialog')
        await page.setInputFiles('.sky-attach-dialog input[type="file"]', {
          name: 'notes.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('a few notes'),
        })
        await page.waitForSelector(chip('notes.txt'))
        const copyNote = await page.textContent('.sky-rail-note span')
        await waitForAutosave(page)
        const afterCopy = await readMarkdownFromDisk(file)
        await page.click('.sky-rail .sky-prop[data-key="attachments"] button[aria-label="Remove deck.pdf"]')
        await waitForAutosave(page)
        const afterRemove = await readMarkdownFromDisk(file)
        const listed = (files: string) => `  - { file: "report.pdf" }\n${files}`
        const deck = '  - { file: "deck.pdf" }\n'
        const chart = '  - { file: "chart.png" }\n'
        const notes = '  - { file: "notes.txt" }\n'
        assert({
          given:
            'the dialog over a day holding one unlisted file; a file chosen from the stand-in Downloads; that file ticked; bytes from nowhere; Remove on the moved one',
          should:
            'list the directory with the listed marked; move the original in and note it with Undo; add the ticked one and note it; copy the bytes; and unlist the first while its file stays',
          actual: [
            rowsBefore,
            note,
            undoOffered,
            movedOut,
            afterMove,
            rowsAfter,
            pickNote,
            afterPick,
            copyNote,
            afterCopy,
            afterRemove,
            errors,
          ],
          expected: [
            [['chart.png', false]],
            'Moved “deck.pdf” here from Downloads',
            true,
            true,
            DOC.replace(listed(''), listed(deck)),
            [
              ['chart.png', false],
              ['deck.pdf', true],
            ],
            'Listed “chart.png”',
            DOC.replace(listed(''), listed(deck + chart)),
            'Kept a copy of “notes.txt” here',
            DOC.replace(listed(''), listed(deck + chart + notes)),
            DOC.replace(listed(''), listed(chart + notes)),
            [],
          ],
        })
      },
    )
  },
)

test(
  {
    name: 'rail — attachment groups use every note in the day, while selection belongs to this document',
    timeout: 40000,
  },
  async (t) => {
    const otherNote = path.posix.join(path.posix.dirname(DAY_DOC), 'notes', 'review.md')
    const nextDayNote = path.posix.join('time', dayDir(new PlainDate('2026-08-06')), 'review.md')
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: DOC,
        tempPrefix: 'wysiwyg-rail-file-groups-',
        file: DAY_DOC,
        files: {
          [otherNote]: '---\nattachments:\n  - file: a-other.pdf\n---\n\n# Budget review\n',
          [nextDayNote]: '---\nattachments:\n  - file: z-other-day.png\n---\n\n# Next review\n',
        },
        store: true,
        day: true,
      },
      async ({ page, origin, relativePath, userDataDir, errors }) => {
        const dayFilesDir = path.join(userDataDir, 'attachments', dayAttachmentsDir(DAY))
        await mkdir(dayFilesDir, { recursive: true })
        for (const name of ['a-other.pdf', 'report.pdf', 'z-other-day.png', 'z-recording.mp4']) {
          await writeFile(path.join(dayFilesDir, name), `Mock bytes for ${name}`)
        }
        await page.setViewportSize({ width: 1400, height: 900 })
        await openEditor(page, origin, relativePath)
        const openPicker = async () => {
          await page.click('.sky-rail-choose')
          await page.waitForSelector('.sky-attach-row')
        }
        await openPicker()
        const groups = await page.evaluate(() =>
          [...document.querySelectorAll('.sky-attach-group')].map((group) => ({
            title: group.getAttribute('aria-label'),
            count: group.querySelector('.sky-attach-count')?.textContent,
            files: [...group.querySelectorAll('.sky-attach-row')].map((row) => {
              const input = row.querySelector('input')!
              return {
                name: row.querySelector('.sky-attach-name')?.textContent,
                note: row.querySelector('.sky-attach-note')?.textContent ?? null,
                checked: input.checked,
                disabled: input.disabled,
              }
            }),
          })),
        )
        assert({
          given:
            'a current attachment, one referenced by a nested note today, two loose files, and a reference tomorrow',
          should: 'put files no note today references first, and allow selecting the file attached to another note',
          actual: groups,
          expected: [
            {
              title: 'Not Attached',
              count: '2',
              files: [
                { name: 'z-other-day.png', note: null, checked: false, disabled: false },
                { name: 'z-recording.mp4', note: null, checked: false, disabled: false },
              ],
            },
            {
              title: 'Attached',
              count: '2',
              files: [
                { name: 'a-other.pdf', note: 'Attached to Budget review', checked: false, disabled: false },
                { name: 'report.pdf', note: null, checked: true, disabled: true },
              ],
            },
          ],
        })
        await page.getByRole('checkbox', { name: 'a-other.pdf', exact: true }).check()
        await page.getByRole('checkbox', { name: 'z-recording.mp4', exact: true }).check()
        await page.getByRole('button', { name: 'Add 2 files', exact: true }).click()
        await waitForAutosave(page)
        await openPicker()
        const counts = await page.locator('.sky-attach-count').allTextContents()
        const attached = await page.locator('.sky-attach-row[data-listed] .sky-attach-name').allTextContents()
        assert({
          given: 'a loose recording and a file attached to another note added to this document',
          should: 'leave the remaining loose file first and mark all three current attachments checked and disabled',
          actual: [counts, attached, await page.locator('.sky-attach-row input:checked:disabled').count(), errors],
          expected: [['1', '3'], ['a-other.pdf', 'report.pdf', 'z-recording.mp4'], 3, []],
        })
      },
    )
  },
)
