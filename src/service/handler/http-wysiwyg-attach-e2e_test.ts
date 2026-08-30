// CLP-16 — a file pasted or dropped into a document is copied beside it and linked by name: a day
// document's into the day's attachments, recorded in its frontmatter; any other's into the media
// mirror of its directory.

import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  dispatchFilePaste,
  openEditor,
  placeCaret,
  PNG_1X1_BASE64,
  readMarkdownFromDisk,
  runWysiwygE2e,
  waitForAutosave,
} from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-03-05')
const DAY_DOC = path.posix.join('time', dayDir(DAY), 'standup.md')

test(
  { name: 'CLP-16 — a pasted image is stored in the media mirror of the document directory and shown', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: 'Hello\n', tempPrefix: 'wysiwyg-attach-' },
      async ({ page, origin, file, userDataDir, errors }) => {
        await openEditor(page, origin)
        await placeCaret(page, 'p', 5)
        await page.keyboard.press('Enter')
        await dispatchFilePaste(page, { name: 'dot.png', type: 'image/png', base64: PNG_1X1_BASE64 })
        await page.waitForFunction(() => {
          const img = document.querySelector<HTMLImageElement>('.sky-wysiwyg img')
          return img !== null && img.complete && img.naturalWidth === 1
        })
        await waitForAutosave(page)
        assert({
          given: 'an image file pasted into a new paragraph of a library document',
          should:
            'link it by bare name, store the bytes in the mirror of the document directory, and show it — no errors',
          actual: [await readMarkdownFromDisk(file), await readdir(path.join(userDataDir, 'notes')), errors],
          expected: ['Hello\n\n![dot.png](dot.png)\n', ['dot.png'], []],
        })
      },
    )
  },
)

test(
  { name: "CLP-16 — a day document's pasted file joins the day attachments and its frontmatter", timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '---\ntitle: Standup\n---\n\nHello\n', tempPrefix: 'wysiwyg-attach-day-', file: DAY_DOC },
      async ({ page, origin, file, relativePath, userDataDir, errors }) => {
        await openEditor(page, origin, relativePath)
        await placeCaret(page, 'p', 5)
        await page.keyboard.press('Enter')
        const pdf = Buffer.from('%PDF-1.4 stub').toString('base64')
        await dispatchFilePaste(page, { name: 'report.pdf', type: 'application/pdf', base64: pdf })
        await page.waitForSelector('.sky-wysiwyg a[href="report.pdf"]')
        await waitForAutosave(page)
        const served = await fetch(`${origin}/docs/_api/file/${path.posix.dirname(relativePath)}/report.pdf`)
        assert({
          given: 'a PDF pasted into a day document that already has frontmatter',
          should:
            "link it by name, record it under attachments:, store it in the day's attachments, and serve it beside the document",
          actual: [
            await readMarkdownFromDisk(file),
            await readdir(path.join(userDataDir, 'attachments', dayAttachmentsDir(DAY))),
            [served.status, served.headers.get('content-type')],
            errors,
          ],
          expected: [
            '---\ntitle: Standup\nattachments:\n  - { file: "report.pdf" }\n---\n\nHello\n\n[report.pdf](report.pdf)\n',
            ['report.pdf'],
            [200, 'application/pdf'],
            [],
          ],
        })
      },
    )
  },
)
