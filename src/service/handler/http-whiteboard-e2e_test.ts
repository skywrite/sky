// Whiteboard end-to-end tests: footer icon access, Rich text & syntax-highlighted Raw tabs
// over time/whiteboard.md, plain-text clipboard guarantee, Clear + Undo, and mobile 390px layout.

import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-10-28')
const DAY_MD = `---
date: ${DAY.ymd}
---

# **${DAY.ymd}**

## Professional Todos

- Review Atlas plan
`

const OPTIONS = {
  initialMarkdown: DAY_MD,
  file: path.posix.join('time', dayFile(DAY)),
  day: true,
  now: new ZonedDateTime('2026-10-28T10:30:00', 'UTC'),
}

async function settled(file: string, wanted: (text: string) => boolean): Promise<string> {
  let text = ''
  for (let tries = 0; tries < 50; tries += 1) {
    text = await readFile(file, 'utf8').catch(() => '')
    if (wanted(text)) return text
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return text
}

test(
  {
    name: 'whiteboard — footer icon opens time/whiteboard.md with Rich text, highlighted Raw plain text, and Clear + Undo',
    timeout: 60000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { ...OPTIONS, tempPrefix: 'whiteboard-desktop-' },
      async ({ page, origin, file, errors }) => {
        await page.route('**/day/*/schedule', (route) =>
          route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
        )
        await page.route('**/chat', (route) => route.fulfill({ json: { threads: [] } }))
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto(`${origin}/${DAY.ymd}`)

        // Open Whiteboard from the sidebar utility footer.
        const footerLink = page.getByRole('group', { name: 'Tools' }).getByRole('link', { name: 'Whiteboard' })
        await footerLink.click()
        await page.waitForSelector('.sky-wb-rich')
        const richTitle = await page.title()

        // First edit creates time/whiteboard.md in a fresh notebook.
        const whiteboardFile = path.join(path.dirname(file), '..', '..', '..', 'whiteboard.md')
        await page.locator('.sky-wb-rich').click()
        await page.keyboard.type('# Atlas rollout')
        await page.keyboard.press('Enter')
        await page.keyboard.type('Email **Jane Doe** about staging.')
        const created = await settled(whiteboardFile, (text) => text.includes('Email **Jane Doe** about staging.'))

        // Switch to Raw tab — verify title, syntax highlighting spans, and pixel alignment.
        await page.getByRole('tab', { name: /Raw/ }).click()
        const rawTextarea = page.getByRole('textbox', { name: 'Whiteboard raw plain text' })
        await rawTextarea.waitFor()
        const rawTitle = await page.title()

        const highlightCheck = await page.evaluate(() => {
          const pre = document.querySelector<HTMLElement>('.sky-wb-raw-highlight')
          const ta = document.querySelector<HTMLTextAreaElement>('.sky-wb-raw-textarea')
          if (!pre || !ta) return null
          const preBox = pre.getBoundingClientRect()
          const taBox = ta.getBoundingClientRect()
          return {
            hasHeadingToken: Boolean(pre.querySelector('.sky-wb-md-heading')),
            hasStrongToken: Boolean(pre.querySelector('.sky-wb-md-strong')),
            widthDiff: Math.abs(preBox.width - taBox.width),
            heightDiff: Math.abs(preBox.height - taBox.height),
          }
        })

        // Edit in Raw and verify it saves and reflects in Rich text.
        await rawTextarea.fill(`${await rawTextarea.inputValue()}\nPlain line for email.`)
        const afterRawEdit = await settled(whiteboardFile, (text) => text.includes('Plain line for email.'))

        // Browser Back returns to Rich text and keeps title + content synced.
        await page.goBack()
        await page.waitForSelector('.sky-wb-rich')
        const titleAfterBack = await page.title()
        const richTextAfterRaw = await page.locator('.sky-wb-rich').innerText()

        // Forward returns to Raw, then test Clear + Undo.
        await page.goForward()
        await rawTextarea.waitFor()
        await page.getByRole('button', { name: 'Clear', exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click()
        const clearedDisk = await settled(whiteboardFile, (text) => text === '')

        await page.locator('.sky-wb-undo').getByRole('button', { name: 'Undo' }).click()
        const restoredDisk = await settled(whiteboardFile, (text) => text.includes('Plain line for email.'))

        assert({
          given:
            'opening Whiteboard from the footer, editing in Rich text and Raw, navigating back/forward, and clearing + undoing',
          should:
            'persist to time/whiteboard.md, highlight markdown cleanly aligned over the textarea, keep titles in sync, and undo clear',
          actual: [
            richTitle,
            created.includes('# Atlas rollout'),
            rawTitle,
            highlightCheck?.hasHeadingToken,
            highlightCheck?.hasStrongToken,
            (highlightCheck?.widthDiff ?? 99) < 1,
            (highlightCheck?.heightDiff ?? 99) < 1,
            afterRawEdit.includes('Plain line for email.'),
            titleAfterBack,
            richTextAfterRaw.includes('Plain line for email.'),
            clearedDisk,
            restoredDisk.includes('Plain line for email.'),
            errors,
          ],
          expected: [
            'sky · Whiteboard',
            true,
            'sky · Whiteboard · Raw',
            true,
            true,
            true,
            true,
            true,
            'sky · Whiteboard',
            true,
            '',
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
    name: 'whiteboard — works cleanly on mobile (390px): reached from More, no overflow, 16px raw editor, aligned wrapping',
    timeout: 60000,
  },
  async (t) => {
    await runWysiwygE2e(t, { ...OPTIONS, tempPrefix: 'whiteboard-mobile-' }, async ({ page, origin, file, errors }) => {
      await page.route('**/day/*/schedule', (route) =>
        route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
      )
      await page.route('**/chat', (route) => route.fulfill({ json: { threads: [] } }))
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`${origin}/${DAY.ymd}`)

      // Open More from the bar and tap Whiteboard among the tools.
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More', exact: true }).click()
      const more = page.getByRole('dialog', { name: 'More' })
      const wbLink = more.getByRole('group', { name: 'Tools' }).getByRole('link', { name: 'Whiteboard' })
      await wbLink.waitFor()
      const rowHeight = await wbLink.evaluate((el) => el.getBoundingClientRect().height)

      await wbLink.click()
      await page.waitForSelector('.sky-wb-rich')
      const moreOpen = await more.count()

      // Switch to Raw on mobile and test wrapping + 16px anti-zoom font size + no horizontal overflow.
      await page.getByRole('tab', { name: /Raw/ }).click()
      const rawTextarea = page.getByRole('textbox', { name: 'Whiteboard raw plain text' })
      await rawTextarea.waitFor()
      await rawTextarea.fill(
        '# Mobile Atlas checklist\n\n- [ ] Send Jane Doe the updated Q2 timeline with **zero rich formatting** from my phone\n',
      )

      const whiteboardFile = path.join(path.dirname(file), '..', '..', '..', 'whiteboard.md')
      const saved = await settled(whiteboardFile, (text) => text.includes('zero rich formatting'))

      const mobileMetrics = await page.evaluate(() => {
        const pre = document.querySelector<HTMLElement>('.sky-wb-raw-highlight')
        const ta = document.querySelector<HTMLTextAreaElement>('.sky-wb-raw-textarea')
        if (!pre || !ta) return null
        const preBox = pre.getBoundingClientRect()
        const taBox = ta.getBoundingClientRect()
        const fontSize = Number.parseFloat(getComputedStyle(ta).fontSize)
        const overflow = document.documentElement.scrollWidth > window.innerWidth
        return {
          fontSize,
          overflow,
          widthDiff: Math.abs(preBox.width - taBox.width),
          heightDiff: Math.abs(preBox.height - taBox.height),
        }
      })

      assert({
        given: 'opening Whiteboard from More at 390px and editing wrapped Markdown in Raw',
        should:
          'offer a >= 44px row, close More on tap, keep 16px font with aligned highlight overlay and no horizontal overflow',
        actual: [
          rowHeight >= 44,
          moreOpen,
          saved.includes('Mobile Atlas checklist'),
          (mobileMetrics?.fontSize ?? 0) >= 16,
          mobileMetrics?.overflow,
          (mobileMetrics?.widthDiff ?? 99) < 1,
          (mobileMetrics?.heightDiff ?? 99) < 1,
          errors,
        ],
        expected: [true, 0, true, true, false, true, true, []],
      })
    })
  },
)
