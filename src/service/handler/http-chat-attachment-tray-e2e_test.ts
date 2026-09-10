import { agreementPdf } from '#lib/legalReview/testHelpers.ts'
import { assert, test } from '#test'
import { FILE_CHAT_REPLY, fileChatHost } from './chat/filesTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  { name: 'five dropped attachments stay visible with format icons, a live count and a long message', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock attachment notebook\n',
        tempPrefix: 'sky-attachment-tray-',
        day: true,
        chat: (root) => fileChatHost(root).host,
      },
      async ({ page, origin, errors }) => {
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/thread/attachments`)
        const composer = page.locator('.sky-composer')
        const input = composer.getByRole('textbox', { name: 'Message sky…', exact: true })
        const prompt = [
          'I am uploading five related agreements. Review them together using the context already established.',
          'Keep the discussion in this chat. Highlight material issues and cite the relevant document and clause.',
          'Compare the definitions and notice terms, and revisit earlier findings when a later agreement changes them.',
          'After all five have been reviewed, give me a prioritized list of questions for the team.',
        ].join('\n\n')
        await input.fill(prompt)
        const names = [
          '[Clean] Atlas - Master Services Agreement - Review copy 2026-02-04.docx',
          'Widget - Supplemental Terms - Proposed revision.doc',
          'Atlas - Services Schedule - Customer version.pdf',
          'Atlas - Data Processing Addendum - Review copy.pdf',
          'Supporting-diagram.png',
        ]
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4VQAAAAASUVORK5CYII='
        const data = await page.evaluateHandle(
          ({ names, pdf, png }) => {
            const transfer = new DataTransfer()
            const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
            transfer.items.add(
              new File([new Uint8Array(750 * 1024)], names[0], {
                type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              }),
            )
            transfer.items.add(new File(['Synthetic Word fixture'], names[1], { type: 'application/msword' }))
            transfer.items.add(new File([bytes(pdf)], names[2], { type: 'application/pdf' }))
            transfer.items.add(new File([bytes(pdf)], names[3], { type: 'application/pdf' }))
            transfer.items.add(new File([bytes(png)], names[4], { type: 'image/png' }))
            return transfer
          },
          { names, pdf: Buffer.from(agreementPdf('Synthetic agreement terms.')).toString('base64'), png },
        )
        await page.locator('.sky-chat-drop-target').dispatchEvent('dragenter', { dataTransfer: data })
        await page.locator('.sky-chat-drop-target').dispatchEvent('drop', { dataTransfer: data })
        const tray = composer.locator('.sky-chat-attachments')
        await tray.getByText('5 files attached', { exact: true }).waitFor()
        await page.waitForFunction(
          () =>
            (document.querySelector('.sky-composer .sky-chat-file-thumbnail') as HTMLImageElement)?.naturalWidth > 0,
        )
        assert({
          given: 'a drop containing Word documents, PDFs and an image',
          should: 'show distinct document icons and a decoded image thumbnail without sending the message',
          actual: {
            word: await tray.locator('svg[data-kind="word"]').count(),
            pdf: await tray.locator('svg[data-kind="pdf"]').count(),
            images: await tray.locator('img').count(),
            count: await tray.getByRole('listitem').count(),
            turns: await page.locator('.sky-turn').count(),
          },
          expected: { word: 2, pdf: 2, images: 1, count: 5, turns: 0 },
        })
        for (const [width, height] of [
          [1500, 1000],
          [1200, 760],
          [390, 844],
        ]) {
          await page.setViewportSize({ width, height })
          await page.waitForTimeout(250)
          const layout = await composer.evaluate((element) => {
            const field = element.querySelector('.sky-composer-shell')!.getBoundingClientRect()
            const list = element.querySelector('.sky-chat-files')!
            const header = element.querySelector('.sky-chat-attachments-head')!.getBoundingClientRect()
            const input = element.querySelector('textarea')!.getBoundingClientRect()
            const send = element.querySelector('[aria-label="Send"]')!.getBoundingClientRect()
            const cards = [...list.querySelectorAll('.sky-chat-file')].map((card) => card.getBoundingClientRect())
            return {
              countVisible: header.top >= 0 && header.bottom < window.innerHeight,
              allFiveVisible:
                cards.length === 5 &&
                cards.every(
                  (card) =>
                    card.left >= field.left &&
                    card.right <= field.right &&
                    card.top >= header.bottom &&
                    card.bottom <= input.top &&
                    card.top >= 0 &&
                    card.bottom < window.innerHeight,
                ),
              noHiddenRows: list.scrollHeight <= list.clientHeight + 1,
              sendVisible: send.top >= 0 && send.bottom < window.innerHeight,
              pageFits: document.documentElement.scrollWidth <= window.innerWidth,
            }
          })
          await page.screenshot({ path: `/tmp/sky-attachment-tray-${width}.png` })
          assert({
            given: `five files and a long prompt in a ${width} by ${height} window`,
            should: 'show the count, every complete file card and Send without clipping attachments',
            actual: layout,
            expected: {
              countVisible: true,
              allFiveVisible: true,
              noHiddenRows: true,
              sendVisible: true,
              pageFits: true,
            },
          })
        }
        await tray.getByRole('button', { name: 'Hide files', exact: true }).click()
        assert({
          given: 'the files are collapsed to focus on writing',
          should: 'keep the count and the whole message',
          actual: {
            label: await tray.getByText('5 files attached', { exact: true }).isVisible(),
            expanded: await tray.getByRole('button', { name: 'Show files', exact: true }).getAttribute('aria-expanded'),
            text: await input.inputValue(),
          },
          expected: { label: true, expanded: 'false', text: prompt },
        })
        await tray.getByRole('button', { name: 'Show files', exact: true }).click()
        await tray.getByRole('button', { name: `Remove ${names[0]}`, exact: true }).click()
        await tray.getByText('4 files attached', { exact: true }).waitFor()
        await tray.getByRole('button', { name: `Remove ${names[1]}`, exact: true }).click()
        await tray.getByText('3 files attached', { exact: true }).waitFor()
        // Only the queue needs Word-format fixtures; the existing converter is outside this layout scenario.
        await composer.locator('input[type="file"]').setInputFiles([
          { name: 'Atlas - Terms.md', mimeType: 'text/markdown', buffer: Buffer.from('# Terms\nSynthetic terms.') },
          { name: 'Atlas - Definitions.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic definitions.') },
        ])
        await tray.getByText('5 files attached', { exact: true }).waitFor()
        await composer.getByRole('button', { name: 'Send', exact: true }).click()
        await page.getByText(FILE_CHAT_REPLY, { exact: true }).waitFor()
        const sent = page.locator('.sky-turn-user .sky-chat-attachments')
        assert({
          given: 'the five files have been sent',
          should: 'keep their count and format icons in the message and clear the pending tray',
          actual: {
            count: await sent.getByRole('listitem').count(),
            pdf: await sent.locator('svg[data-kind="pdf"]').count(),
            images: await sent.locator('img').count(),
            pending: await composer.locator('.sky-chat-file').count(),
          },
          expected: { count: 5, pdf: 2, images: 1, pending: 0 },
        })
        await page.reload()
        await sent.getByText('5 files attached', { exact: true }).waitFor()
        assert({
          given: 'the chat is reloaded',
          should: 'preserve the attachment collection and PDF icons',
          actual: {
            count: await sent.getByRole('listitem').count(),
            pdf: await sent.locator('svg[data-kind="pdf"]').count(),
            errors: errors.filter((error) => !error.includes('404')),
          },
          expected: { count: 5, pdf: 2, errors: [] },
        })
      },
    )
  },
)
