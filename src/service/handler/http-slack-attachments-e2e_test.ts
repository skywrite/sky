import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { updateSlackCapture } from '#commands/all/slack/lib/updateCapture.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'Saved Slack attachments jump from their message to the original file',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-slack-attachments-browser-'))
    const original = path.join(root, 'report.pdf')
    const memo = path.join(root, 'memo.m4a')
    const relativePath = resolveTimeRef('2026-04-10/actions/messages/slack_Atlas.md')
    const userDataDir = path.join(root, 'user-data')
    const filePath = path.join(root, relativePath)
    await writeFile(original, 'Synthetic PDF bytes')
    await writeFile(memo, 'Synthetic voice memo bytes')
    await mkdir(path.dirname(filePath), { recursive: true })
    const doc = await updateSlackCapture({
      doc: new MessageDocument(
        { medium: 'Slack', summary: 'Atlas', when: '2026-04-10 09:00', follow: 'atlas-follow' },
        '',
      ),
      messages: [
        {
          channelId: 'C0ATLAS',
          ts: '1770000000.000001',
          timeLabel: '2026-04-10 09:00',
          userName: 'Jane Doe',
          text: '',
          files: [
            { id: 'F0REPORT', name: 'report.pdf', path: original },
            {
              id: 'F0MEMO',
              name: 'memo.m4a',
              path: memo,
              voiceMemo: {
                workspaceUrl: 'https://atlas.slack.com',
                transcript: 'Please review the Atlas report tomorrow.',
              },
            },
          ],
        },
        {
          channelId: 'C0ATLAS',
          ts: '1770000000.000002',
          timeLabel: '2026-04-10 09:01',
          userName: 'John Smith',
          text: Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}: review the Atlas report.`).join('\n\n'),
        },
      ],
      day: new PlainDate('2026-04-10'),
      output: { log: () => {} },
      attachmentsRoot: path.join(userDataDir, 'attachments'),
    })
    await writeFile(filePath, doc.toMarkdown())
    const app = createTestHttpApp([path.join(root, 'time')], { userDataDir })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
      const origin = `http://127.0.0.1:${address.port}`
      await page.goto(`${origin}/explorer/${relativePath}`)
      const body = await page.locator('.sky-doc-body').innerText()
      assert({
        given: 'a voice note beside a PDF in the first message',
        should: 'show its labeled transcript once before the next sender',
        actual: [
          body.includes('(voice memo transcript)'),
          body.split('Please review the Atlas report tomorrow.').length - 1,
          body.indexOf('Please review the Atlas report tomorrow.') < body.indexOf('John Smith'),
        ],
        expected: [true, 1, true],
      })
      const reference = page.locator('.sky-doc-body a[href="#attachment-slack-F0REPORT"]')
      await reference.click()
      await page.waitForFunction(() => location.hash === '#attachment-slack-F0REPORT')
      const originalLink = page
        .locator('.sky-doc-body')
        .getByRole('link', { name: 'Original file', exact: true })
        .first()
      const box = await originalLink.boundingBox()
      const href = await originalLink.getAttribute('href')
      const response = await page.request.get(new URL(href!, origin).toString())
      const railHref = await page.locator('.sky-prop-chip.file').first().getAttribute('href')
      const railResponse = await page.request.get(new URL(railHref!, origin).toString())
      assert({
        given: 'a message links to an attachment after a long conversation',
        should: 'scroll to its entry and serve the preserved original bytes',
        actual: [
          !!box && box.y >= 0 && box.y < 900,
          response.status(),
          await response.text(),
          railResponse.status(),
          await railResponse.text(),
        ],
        expected: [true, 200, 'Synthetic PDF bytes', 200, 'Synthetic PDF bytes'],
      })
      assert({
        given: 'the attachment jump',
        should: 'stay on the same saved conversation',
        actual: new URL(page.url()).pathname,
        expected: `/explorer/${relativePath}`,
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await rm(root, { recursive: true, force: true })
    }
  },
)
