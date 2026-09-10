import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { imageChatHost } from './chat/imagesTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  {
    name: 'chat displays generated images before the reply, downloads them, and retains uploaded edit references',
    timeout: 60000,
  },
  async (t) => {
    let fixture: ReturnType<typeof imageChatHost>
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Test notebook\n',
        tempPrefix: 'chat-images-browser-',
        day: true,
        chat: (root) => {
          fixture = imageChatHost(root)
          return fixture.host
        },
      },
      async ({ page, origin, errors }) => {
        let releasePreview = () => {}
        const previewReady = new Promise<void>((resolve) => {
          releasePreview = resolve
        })
        await page.route('**/chat/files/**?preview=1', async (route) => {
          await previewReady
          await route.continue()
        })
        await page.goto(`${origin}/thread/images`)
        const composer = page.getByRole('textbox', { name: 'Message sky…', exact: true })
        const send = page.getByRole('button', { name: 'Send', exact: true })
        await composer.waitFor()
        await page.waitForFunction(
          () => !(document.querySelector('button[aria-label="Send"]') as HTMLButtonElement)?.disabled,
        )
        await composer.fill('Create a lighthouse illustration.')
        await send.click()
        const images = page.locator('.sky-chat-image img')
        await images.first().waitFor({ state: 'attached' })
        await page.locator('.sky-chat-image-preview').first().waitFor()
        assert({
          given: 'the image tool has completed while the final reply is still pending',
          should: 'show the image immediately',
          actual: [await images.count(), await page.getByText('Here is image 1.', { exact: true }).count()],
          expected: [1, 0],
        })
        fixture!.releaseFirst()
        await page.getByText('Here is image 1.', { exact: true }).waitFor()
        releasePreview()
        await page.waitForFunction(() =>
          [...document.querySelectorAll('.sky-chat-image img')].every(
            (image) => (image as HTMLImageElement).naturalWidth > 0,
          ),
        )
        assert({
          given: 'the final reply also carries the retained image link',
          should: 'display one decoded image without duplicate Markdown previews',
          actual: await page.locator('.sky-turn:not(.sky-turn-user) img').count(),
          expected: 1,
        })
        await page.waitForFunction(() => {
          const scroll = document.querySelector('.sky-scroll')!
          return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 5
        })
        const popup = page.waitForEvent('popup')
        await page.getByRole('link', { name: 'Open lighthouse-1.png at full size', exact: true }).click()
        const full = await popup
        await full.waitForLoadState()
        assert({
          given: 'the preview is clicked',
          should: 'open the original image at full size',
          actual: await full.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth),
          expected: 1,
        })
        await full.close()
        const download = page.waitForEvent('download')
        await page.getByRole('link', { name: 'Download lighthouse-1.png', exact: true }).click()
        assert({
          given: 'Download is clicked',
          should: 'download the retained image file',
          actual: (await download).suggestedFilename(),
          expected: 'lighthouse-1.png',
        })
        await page.reload()
        await page.getByText('Here is image 1.', { exact: true }).waitFor()
        assert({
          given: 'the browser reloads',
          should: 'restore the same inline image',
          actual: await images.count(),
          expected: 1,
        })
        const transfer = await page.evaluateHandle(async () => {
          const data = new DataTransfer()
          const preview = document.querySelector('.sky-chat-image img') as HTMLImageElement
          const bytes = await (await fetch(preview.src)).arrayBuffer()
          data.items.add(new File([bytes], 'family-photo.png', { type: 'image/png' }))
          return data
        })
        await page.locator('.sky-chat-drop-target').dispatchEvent('drop', { dataTransfer: transfer })
        await page.getByRole('button', { name: 'Remove family-photo.png', exact: true }).waitFor()
        await composer.fill('Change the background while keeping the people the same.')
        let releaseUpload = () => {}
        const uploadReady = new Promise<void>((resolve) => {
          releaseUpload = resolve
        })
        await page.route(`${origin}/chat/images/messages`, async (route) => {
          await uploadReady
          await route.continue()
        })
        await send.click()
        const thumbnail = page.locator('.sky-turn-user .sky-chat-file-thumbnail')
        await page.waitForFunction(
          () =>
            (document.querySelector('.sky-turn-user .sky-chat-file-thumbnail') as HTMLImageElement)?.naturalWidth > 0,
        )
        assert({
          given: 'the photo and prompt are sent while the upload is still in flight',
          should: 'keep a decoded local thumbnail inside the same bubble as the prompt',
          actual: [
            (await thumbnail.getAttribute('src'))?.startsWith('blob:'),
            await page.locator('.sky-turn-user').last().locator('.sky-bubble').count(),
            await page.locator('.sky-turn-user').last().locator('.sky-bubble .sky-chat-file-thumbnail').count(),
            await page.locator('.sky-turn-user').last().locator('.sky-bubble-text').innerText(),
          ],
          expected: [true, 1, 1, 'Change the background while keeping the people the same.'],
        })
        releaseUpload()
        await page.getByText('Here is image 2.', { exact: true }).waitFor()
        await page.waitForFunction(() => {
          const image = document.querySelector('.sky-turn-user .sky-chat-file-thumbnail') as HTMLImageElement
          return image?.naturalWidth > 0 && image.src.endsWith('?preview=1')
        })
        assert({
          given: 'a photo is dropped with an editing prompt',
          should: 'give the model native image input and retained edit paths, and display its new image',
          actual: {
            images: await images.count(),
            native: JSON.stringify(fixture!.calls[1]!.messages).includes('"type":"image"'),
            input: fixture!.calls[1]!.files.includes('family-photo.png'),
            previous: fixture!.calls[1]!.files.includes('lighthouse-1.png'),
          },
          expected: { images: 2, native: true, input: true, previous: true },
        })
        const messages = fixture!.calls[1]!.messages.filter((message) => message.role === 'user')
        assert({
          given: 'the chat JSON contains the uploaded photo and text',
          should: 'send both within one user message, with a durable thumbnail after the server accepts it',
          actual: [
            messages.length,
            JSON.stringify(messages.at(-1)).includes('Change the background while keeping the people the same.'),
            JSON.stringify(messages.at(-1)).includes('"type":"image"'),
            await thumbnail.count(),
          ],
          expected: [2, true, true, 1],
        })
        await page.reload()
        await page.getByText('Here is image 2.', { exact: true }).waitFor()
        await page.waitForFunction(
          () =>
            (document.querySelector('.sky-turn-user .sky-chat-file-thumbnail') as HTMLImageElement)?.naturalWidth > 0,
        )
        await page.screenshot({ path: path.join(os.tmpdir(), 'sky-chat-images-desktop.png') })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.waitForFunction(() => document.querySelector('.sky-side')!.getBoundingClientRect().right <= 0)
        await page.screenshot({ path: path.join(os.tmpdir(), 'sky-chat-images-mobile.png') })
        assert({
          given: 'the generated image cards are viewed on a phone',
          should: 'fit without horizontal overflow or browser errors',
          actual: {
            overflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
            errors,
          },
          expected: { overflow: false, errors: [] },
        })
      },
    )
  },
)
