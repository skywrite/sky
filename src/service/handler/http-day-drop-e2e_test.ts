// The day's drop: a file dropped on the day is an import, wherever it lands — the page, the
// Files panel's header, its rows. Only the Files pad keeps a file as it is, and only the Files
// button opens the panel; a drag never does. Left out of `dev:test:unit` (a real browser); run
// it with `bun test service/handler/http-day-drop-e2e_test.ts`.

import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { exists } from '#shared/fs/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dispatchFileDrag, dispatchFileDrop, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-08-05')
const DAY_DOC = path.posix.join('time', dayFile(DAY))
const DAY_MARKDOWN = `---
created: 2026-08-05 07:00
---

# **2026-08-05**

## Most important

- [ ] Ship the Atlas deck
`
const TRANSCRIPT = `WEBVTT

00:00:00.000 --> 00:00:04.000
<v Jane Doe>Morning, all. A quick recap of the Atlas plan.

00:00:04.000 --> 00:00:09.000
<v Jamal Reyes>Launch in September, and the pricing sync is next week.
`

test(
  {
    name: 'day — a dropped file is an import wherever it lands; the pad alone keeps, and the button alone opens it',
    timeout: 60000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: DAY_MARKDOWN, tempPrefix: 'day-drop-', file: DAY_DOC, day: true },
      async ({ page, origin, userDataDir, errors }) => {
        await page.setViewportSize({ width: 1400, height: 900 })
        await page.goto(`${origin}/${DAY.ymd}`)
        // The header's Files button comes alive once the day has loaded.
        await page.waitForSelector('.sky-day .sky-head button:has-text("Files"):not([disabled])')
        const dir = path.join(userDataDir, 'attachments', dayAttachmentsDir(DAY))
        const listDir = async () => ((await exists(dir)) ? (await readdir(dir)).sort() : [])
        const panelOpen = () => page.evaluate(() => document.querySelector('.sky-files') !== null)
        const dialogOpen = () => page.evaluate(() => document.querySelector('.sky-confirm') !== null)
        const recap = { name: 'recap.vtt', type: 'text/vtt', text: TRANSCRIPT }

        // Held over the page: the overlay, and no panel.
        await dispatchFileDrag(page, '.sky-day .sky-col', recap)
        const overlayShown = await page.isVisible('.sky-drop')
        const openedByDrag = await panelOpen()

        // Let go on the page: the import dialog, and nothing in the directory.
        await dispatchFileDrop(page, '.sky-day .sky-col', recap)
        await page.waitForSelector('.sky-confirm-title:has-text("from a transcript")')
        const dropTitle = await page.textContent('.sky-confirm-title')
        const dropFile = (await page.textContent('.sky-confirm-file'))?.split(' · ')[0]
        const dirAfterDrop = await listDir()
        const panelAfterDrop = await panelOpen()
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await page.waitForSelector('.sky-confirm', { state: 'detached' })

        // The button opens the panel; a drop on the pad keeps, with no dialog.
        await page.click('.sky-day .sky-head button:has-text("Files")')
        await page.waitForSelector('.sky-files .sky-pad[data-drop-pad]')
        await dispatchFileDrop(page, '.sky-files .sky-pad', {
          name: 'atlas-deck.pdf',
          type: 'application/pdf',
          text: '%PDF-1.4 deck',
        })
        await page.waitForSelector('.sky-files .sky-file-name:has-text("atlas-deck.pdf")')
        const toast = await page.textContent('.sky-undo-text')
        const dirAfterPad = await listDir()
        const dialogAfterPad = await dialogOpen()

        // A drop on the panel's own rows, beside the pad, is an import like anywhere else.
        await dispatchFileDrop(page, '.sky-files .sky-file', {
          name: 'notes.txt',
          type: 'text/plain',
          text: 'A few notes from the call.',
        })
        await page.waitForSelector('.sky-confirm-title:has-text("from a text file")')
        const rowsTitle = await page.textContent('.sky-confirm-title')
        const rowsFile = (await page.textContent('.sky-confirm-file'))?.split(' · ')[0]
        const dirAfterRows = await listDir()
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await page.waitForSelector('.sky-confirm', { state: 'detached' })

        assert({
          given:
            'a day page; a transcript held over it, then dropped on it; the Files button; a file dropped on the pad; a text dropped on the panel’s rows',
          should:
            'show the overlay and open no panel; open the import dialog with the directory untouched; open the panel from the button; keep from the pad with no dialog; import from the rows',
          actual: [
            overlayShown,
            openedByDrag,
            dropTitle,
            dropFile,
            dirAfterDrop,
            panelAfterDrop,
            toast,
            dirAfterPad,
            dialogAfterPad,
            rowsTitle,
            rowsFile,
            dirAfterRows,
            errors,
          ],
          expected: [
            true,
            false,
            'New meeting from a transcript',
            'recap.vtt',
            [],
            false,
            'Kept a copy of “atlas-deck.pdf” with 2026-08-05',
            ['atlas-deck.pdf'],
            false,
            'New meeting from a text file',
            'notes.txt',
            ['atlas-deck.pdf'],
            [],
          ],
        })
      },
    )
  },
)
