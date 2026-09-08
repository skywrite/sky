import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { FILE_CHAT_REPLY, fileChatHost } from './chat/filesTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  { name: 'chat clips files from drop, picker and paste; uploads read, retry, download and reload', timeout: 60000 },
  async (t) => {
    let fixture: ReturnType<typeof fileChatHost>
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Test notebook\n',
        tempPrefix: 'chat-files-browser-',
        day: true,
        chat: (root) => {
          fixture = fileChatHost(root)
          return fixture.host
        },
      },
      async ({ page, origin, errors }) => {
        await page.goto(`${origin}/thread/attachments`)
        const composer = page.getByRole('textbox', { name: 'Message sky…', exact: true })
        const send = page.getByRole('button', { name: 'Send', exact: true })
        await composer.waitFor()
        await page.waitForFunction(
          () => !(document.querySelector('button[aria-label="Send"]') as HTMLButtonElement)?.disabled,
        )
        const transfer = await page.evaluateHandle(() => {
          const data = new DataTransfer()
          data.items.add(
            new File(['# Atlas proposal\nA two-week pilot.'], 'Atlas [proposal].md', { type: 'text/markdown' }),
          )
          return data
        })
        const surface = page.locator('.sky-chat-drop-target')
        await surface.dispatchEvent('dragenter', { dataTransfer: transfer })
        await page.getByText('Drop files to read in this chat', { exact: true }).waitFor()
        await surface.dispatchEvent('drop', { dataTransfer: transfer })
        await page.getByRole('button', { name: 'Remove Atlas [proposal].md', exact: true }).waitFor()
        assert({
          given: 'a file dropped anywhere in the conversation',
          should: 'clip it beside the composer without sending or navigating away',
          actual: {
            pending: await page.locator('.sky-composer-zone .sky-chat-file').count(),
            turns: await page.locator('.sky-turn').count(),
            path: new URL(page.url()).pathname,
          },
          expected: { pending: 1, turns: 0, path: '/thread/attachments' },
        })
        await page.getByRole('button', { name: 'Remove Atlas [proposal].md', exact: true }).click()
        const chooser = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Add a file', exact: true }).click()
        await (
          await chooser
        ).setFiles({
          name: 'Atlas [proposal].md',
          mimeType: 'text/markdown',
          buffer: Buffer.from('# Atlas proposal\nA two-week pilot.'),
        })
        await composer.fill('What does the proposal include?')
        await send.click()
        await page.getByText(FILE_CHAT_REPLY, { exact: true }).waitFor()
        const clip = page.locator('.sky-turn-user .sky-chat-file a')
        await clip.waitFor()
        assert({
          given: 'the clipped file is sent with a question',
          should: 'give its contents to the model, clear the draft, and keep a clickable clip on the sent message',
          actual: {
            content: JSON.stringify(fixture!.calls[0]).includes('A two-week pilot.'),
            draft: await composer.inputValue(),
            pending: await page.locator('.sky-composer-zone .sky-chat-file').count(),
            label: await clip.locator('.sky-chat-file-name').innerText(),
            title: await page.locator('.sky-head .sky-title').innerText(),
          },
          expected: {
            content: true,
            draft: '',
            pending: 0,
            label: 'Atlas [proposal].md',
            title: 'What does the proposal include?',
          },
        })
        await page.screenshot({ path: path.join(os.tmpdir(), 'sky-chat-files-desktop.png') })
        const download = page.waitForEvent('download')
        await clip.click()
        assert({
          given: 'the sent clip is clicked',
          should: 'download the notebook copy',
          actual: (await download).suggestedFilename(),
          expected: '2026-01-27_Chat_Atlas-proposal.md',
        })
        await page.reload()
        await page.getByText(FILE_CHAT_REPLY, { exact: true }).waitFor()
        assert({
          given: 'the page reloads',
          should: 'show the same file clipped on its message',
          actual: await clip.locator('.sky-chat-file-name').innerText(),
          expected: 'Atlas [proposal].md',
        })

        await page
          .locator('.sky-composer input[type="file"]')
          .setInputFiles({ name: 'archive.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2]) })
        await composer.fill('Read this too.')
        await send.click()
        await page.getByRole('alert').filter({ hasText: 'binary file' }).waitFor()
        assert({
          given: 'the server cannot read the uploaded file',
          should: 'keep the text and removable file in the composer for correction',
          actual: {
            draft: await composer.inputValue(),
            pending: await page.getByRole('button', { name: 'Remove archive.bin', exact: true }).isVisible(),
            turns: await page.locator('.sky-turn-user').count(),
          },
          expected: { draft: 'Read this too.', pending: true, turns: 1 },
        })
        await page.getByRole('button', { name: 'Remove archive.bin', exact: true }).click()
        await composer.fill('')
        await composer.evaluate((element) => {
          const data = new DataTransfer()
          data.items.add(new File(['Pasted notes about the pilot.'], 'notes.txt', { type: 'text/plain' }))
          element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
        })
        await page.getByRole('button', { name: 'Remove notes.txt', exact: true }).waitFor()
        await send.click()
        await page.locator('.sky-turn-user .sky-chat-file-name').filter({ hasText: 'notes.txt' }).waitFor()
        assert({
          given: 'a pasted file is sent without typed text',
          should: 'read it as an attachment-only message',
          actual: JSON.stringify(fixture!.calls.at(-1)).includes('Pasted notes about the pilot.'),
          expected: true,
        })

        await page.setViewportSize({ width: 390, height: 844 })
        await page.waitForFunction(
          () => !(document.querySelector('button[aria-label="Send"]') as HTMLButtonElement)?.disabled,
        )
        await page.waitForFunction(() => document.querySelector('.sky-side')!.getBoundingClientRect().right <= 0)
        await page.locator('.sky-composer input[type="file"]').setInputFiles({
          name: 'Atlas proposal with a very long descriptive filename and review notes.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\n%%EOF'),
        })
        await page
          .getByRole('button', {
            name: 'Remove Atlas proposal with a very long descriptive filename and review notes.pdf',
            exact: true,
          })
          .waitFor()
        await page.screenshot({ path: path.join(os.tmpdir(), 'sky-chat-files-mobile.png') })
        assert({
          given: 'a long filename is clipped on a phone',
          should: 'fit the viewport and leave the composer usable',
          actual: {
            overflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
            addFile: await page.getByRole('button', { name: 'Add a file', exact: true }).isVisible(),
            errors: errors.filter((error) => !error.includes('400')),
          },
          expected: { overflow: false, addFile: true, errors: [] },
        })
        for (const width of [390, 2240]) {
          await page.setViewportSize({ width, height: 1000 })
          const placement = await page.locator('.sky-composer').evaluate((composer) => {
            const field = composer.querySelector('.sky-composer-shell')!.getBoundingClientRect()
            const clip = composer.querySelector('.sky-chat-file')!.getBoundingClientRect()
            const input = composer.querySelector('textarea')!.getBoundingClientRect()
            const remove = composer.querySelector('.sky-chat-file button')!.getBoundingClientRect()
            return {
              insideField: clip.left >= field.left && clip.right <= field.right && clip.top >= field.top,
              aboveInput: clip.bottom <= input.top,
              removeVisible: remove.left >= clip.left && remove.right <= clip.right,
            }
          })
          assert({
            given: `a pending file in a ${width}px window`,
            should: 'sit inside the same input surface above the message with its remove button visible',
            actual: placement,
            expected: { insideField: true, aboveInput: true, removeVisible: true },
          })
          await page
            .locator('.sky-composer-zone')
            .screenshot({ path: path.join(os.tmpdir(), `sky-chat-files-composer-${width}.png`) })
        }
      },
    )
  },
)
