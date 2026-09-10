import { agreementPdf } from '#lib/legalReview/testHelpers.ts'
import { assert, test } from '#test'
import { FILE_CHAT_REPLY, fileChatHost } from './chat/filesTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  { name: 'unsent text and five attachment bytes survive refresh, navigation and a rejected upload', timeout: 60000 },
  async (t) => {
    let fixture: ReturnType<typeof fileChatHost>
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock draft notebook\n',
        tempPrefix: 'sky-chat-drafts-',
        day: true,
        chat: (root) => {
          fixture = fileChatHost(root)
          return fixture.host
        },
      },
      async ({ page, origin, errors }) => {
        await page.goto(`${origin}/thread/draft-a`)
        const composer = page.locator('.sky-composer')
        const input = composer.getByRole('textbox', { name: 'Message sky…', exact: true })
        const send = composer.getByRole('button', { name: 'Send', exact: true })
        const prompt = '  Review these together.\n\nKeep my exact line breaks — and this unfinished thought…  '
        await input.fill(prompt)
        // No debounce or wait between the last input event and reload.
        await page.reload()
        await input.waitFor()
        assert({
          given: 'text typed before the first message',
          should: 'restore the exact draft on an immediate refresh with the cursor at its end',
          actual: await input.evaluate((element: HTMLTextAreaElement) => ({
            text: element.value,
            focused: element === document.activeElement,
            start: element.selectionStart,
            end: element.selectionEnd,
          })),
          expected: { text: prompt, focused: true, start: prompt.length, end: prompt.length },
        })
        await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 2))
        await input.press('x')
        assert({
          given: 'an edit in the middle of the restored draft',
          should: 'keep the cursor at the edit instead of moving it back to the end',
          actual: await input.evaluate((element: HTMLTextAreaElement) => ({
            start: element.selectionStart,
            end: element.selectionEnd,
          })),
          expected: { start: 3, end: 3 },
        })
        await input.press('Backspace')

        const files = [
          { name: 'Atlas.md', mimeType: 'text/markdown', buffer: Buffer.from('# Atlas\nOriginal mock terms.') },
          {
            name: 'Schedule.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from(agreementPdf('Synthetic schedule.')),
          },
          {
            name: 'Definitions.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Widget means the synthetic service.'),
          },
          {
            name: 'Notes.md',
            mimeType: 'text/markdown',
            buffer: Buffer.from('# Notes\nFollow up on the mock schedule.'),
          },
          {
            name: 'Diagram.png',
            mimeType: 'image/png',
            buffer: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4VQAAAAASUVORK5CYII=',
              'base64',
            ),
          },
        ]
        const dropped = await page.evaluateHandle(
          (files) => {
            const transfer = new DataTransfer()
            for (const file of files)
              transfer.items.add(
                new File([Uint8Array.from(atob(file.bytes), (char) => char.charCodeAt(0))], file.name, {
                  type: file.type,
                }),
              )
            return transfer
          },
          files.map((file) => ({ name: file.name, type: file.mimeType, bytes: file.buffer.toString('base64') })),
        )
        await page.locator('.sky-chat-drop-target').dispatchEvent('drop', { dataTransfer: dropped })
        await composer.getByText('5 files attached', { exact: true }).waitFor()
        await composer.locator('.sky-chat-draft-status').waitFor({ state: 'detached' })
        await page.reload()
        await composer.getByText('5 files attached', { exact: true }).waitFor()
        await page.waitForFunction(
          () => (document.querySelector('.sky-composer img') as HTMLImageElement)?.naturalWidth > 0,
        )
        assert({
          given: 'five dropped files and an unsent prompt after refresh',
          should: 'restore the text, filenames, count, PDF icon and image preview without invoking Sky',
          actual: {
            text: await input.inputValue(),
            names: await composer.locator('.sky-chat-file-name').allTextContents(),
            pdfs: await composer.locator('svg[data-kind="pdf"]').count(),
            calls: fixture!.calls.length,
            cursor: await input.evaluate((element: HTMLTextAreaElement) => ({
              focused: element === document.activeElement,
              start: element.selectionStart,
              end: element.selectionEnd,
            })),
          },
          expected: {
            text: prompt,
            names: files.map((file) => file.name),
            pdfs: 1,
            calls: 0,
            cursor: { focused: true, start: prompt.length, end: prompt.length },
          },
        })

        await page.getByRole('button', { name: 'Chat', exact: true }).click()
        const otherUrl = page.url()
        await input.fill('A separate unfinished conversation.')
        assert({
          given: 'a new chat',
          should: 'keep the previous attachment draft out of this chat',
          actual: await composer.locator('.sky-chat-file').count(),
          expected: 0,
        })
        await page.goBack()
        await composer.getByText('5 files attached', { exact: true }).waitFor()
        assert({
          given: 'back navigation to the original chat ID',
          should: 'restore its own unsent text',
          actual: await input.inputValue(),
          expected: prompt,
        })

        let upload: { name: string; type: string; bytes: string }[] = []
        await page.route(
          '**/chat/draft-a/messages',
          async (route) => {
            const request = route.request()
            const form = await new Response(new Uint8Array(request.postDataBuffer()!), {
              headers: { 'content-type': request.headers()['content-type']! },
            }).formData()
            upload = await Promise.all(
              (form.getAll('files') as File[]).map(async (file) => ({
                name: file.name,
                type: file.type.split(';')[0]!,
                bytes: Buffer.from(await file.arrayBuffer()).toString('base64'),
              })),
            )
            await route.fulfill({ status: 400, json: { message: 'Mock upload refused.' } })
          },
          { times: 1 },
        )
        await send.click()
        await composer.getByRole('alert').filter({ hasText: 'Mock upload refused.' }).waitFor()
        assert({
          given: 'files restored from the draft are submitted',
          should: 'upload every original byte and MIME type in the original order',
          actual: upload,
          expected: files.map((file) => ({
            name: file.name,
            type: file.mimeType,
            bytes: file.buffer.toString('base64'),
          })),
        })
        await page.reload()
        await composer.getByText('5 files attached', { exact: true }).waitFor()
        assert({
          given: 'a rejected upload followed by refresh',
          should: 'keep the unsent message',
          actual: await input.inputValue(),
          expected: prompt,
        })

        await composer.getByRole('button', { name: 'Remove Atlas.md', exact: true }).click()
        await composer.locator('input[type="file"]').setInputFiles({
          name: 'Atlas.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from('# Atlas\nReplacement mock terms.'),
        })
        await input.fill('Review the replacement terms.')
        await composer.locator('.sky-chat-draft-status').waitFor({ state: 'detached' })
        await page.reload()
        await composer.getByText('5 files attached', { exact: true }).waitFor()
        await send.click()
        await page.getByText(FILE_CHAT_REPLY, { exact: true }).waitFor()
        assert({
          given: 'a same-name replacement was saved, reloaded and accepted',
          should: 'submit its new contents and clear only the accepted draft',
          actual: {
            replacement: JSON.stringify(fixture!.calls[0]).includes('Replacement mock terms.'),
            stale: JSON.stringify(fixture!.calls[0]).includes('Original mock terms.'),
            text: await input.inputValue(),
            pending: await composer.locator('.sky-chat-file').count(),
          },
          expected: { replacement: true, stale: false, text: '', pending: 0 },
        })
        await page.reload()
        await page.getByText(FILE_CHAT_REPLY, { exact: true }).waitFor()
        assert({
          given: 'refresh after acceptance',
          should: 'leave the composer empty',
          actual: { text: await input.inputValue(), files: await composer.locator('.sky-chat-file').count() },
          expected: { text: '', files: 0 },
        })
        await page.goto(otherUrl)
        await input.waitFor()
        assert({
          given: 'the other chat is reopened',
          should: 'still hold its own draft',
          actual: await input.inputValue(),
          expected: 'A separate unfinished conversation.',
        })
        await input.fill('')
        await page.reload()
        await input.waitFor()
        assert({
          given: 'the user erased the whole draft',
          should: 'keep it erased after refresh',
          actual: { text: await input.inputValue(), errors: errors.filter((error) => !error.includes('400')) },
          expected: { text: '', errors: [] },
        })
      },
    )
  },
)

test(
  { name: 'attachment draft storage failures keep the input usable and can be retried', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock notebook\n',
        tempPrefix: 'sky-draft-storage-',
        day: true,
        chat: (root) => fileChatHost(root).host,
      },
      async ({ page, origin, errors }) => {
        await page.goto(`${origin}/thread/storage-retry`)
        const composer = page.locator('.sky-composer')
        const input = composer.getByRole('textbox', { name: 'Message sky…', exact: true })
        await input.fill('An unfinished message.')
        await page.evaluate(() => {
          const original = IDBObjectStore.prototype.put
          IDBObjectStore.prototype.put = function (...args) {
            IDBObjectStore.prototype.put = original
            if (this.name === 'files') throw new DOMException('Mock storage is full', 'QuotaExceededError')
            return original.apply(this, args)
          }
        })
        await composer
          .locator('input[type="file"]')
          .setInputFiles({ name: 'Notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep these mock notes.') })
        await composer.getByRole('alert').filter({ hasText: 'attachments could not be saved' }).waitFor()
        assert({
          given: 'the browser refuses an attachment write',
          should: 'retain the text and attachment while making the failure visible',
          actual: { text: await input.inputValue(), files: await composer.locator('.sky-chat-file').count() },
          expected: { text: 'An unfinished message.', files: 1 },
        })
        await composer.getByRole('button', { name: 'Retry', exact: true }).click()
        await composer.getByRole('alert').waitFor({ state: 'detached' })
        await composer.locator('.sky-chat-draft-status').waitFor({ state: 'detached' })
        await page.reload()
        await composer.getByText('Notes.txt', { exact: true }).waitFor()
        await input.fill('')
        await page.reload()
        await composer.getByText('Notes.txt', { exact: true }).waitFor()
        assert({
          given: 'retry succeeded and the text was erased',
          should: 'restore an attachment-only draft',
          actual: await input.inputValue(),
          expected: '',
        })
        await page.addInitScript(() => {
          const original = IDBObjectStore.prototype.get
          IDBObjectStore.prototype.get = function (...args) {
            IDBObjectStore.prototype.get = original
            if (this.name === 'files') throw new DOMException('Mock attachment read failed', 'UnknownError')
            return original.apply(this, args)
          }
        })
        await page.reload()
        await composer.getByRole('alert').filter({ hasText: 'could not be restored' }).waitFor()
        assert({
          given: 'restoring the saved attachment temporarily fails',
          should: 'prevent Send from silently omitting it',
          actual: await composer.getByRole('button', { name: 'Send', exact: true }).isDisabled(),
          expected: true,
        })
        await composer.getByRole('button', { name: 'Retry', exact: true }).click()
        await composer.getByText('Notes.txt', { exact: true }).waitFor()
        await composer.getByRole('alert').waitFor({ state: 'detached' })
        await composer.getByRole('button', { name: 'Remove Notes.txt', exact: true }).click()
        // The synchronous metadata must suppress the old file even if deletion is still in flight.
        await page.reload()
        await input.waitFor()
        assert({
          given: 'the last file was removed immediately before refresh',
          should: 'keep the draft empty',
          actual: { files: await composer.locator('.sky-chat-file').count(), errors },
          expected: { files: 0, errors: [] },
        })
      },
    )
  },
)
