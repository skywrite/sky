import * as os from 'node:os'
import * as path from 'node:path'
import sharp from 'sharp'
import { assert, test } from '#test'
import { splitChatFiles } from '#universal/ai/chatFiles.ts'
import { fileChatHost, FILE_CHAT_REPLY } from './chat/filesTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  {
    name: 'Dropped photos keep editable markup across refreshes, upload failures and sending on mobile',
    timeout: 60000,
  },
  async (t) => {
    let fixture: ReturnType<typeof fileChatHost>
    const photo = await sharp({ create: { width: 960, height: 640, channels: 3, background: '#dad1c0' } })
      .composite([
        {
          input: Buffer.from(
            '<svg width="960" height="640"><rect width="960" height="340" fill="#e6dfd2"/><rect y="340" width="960" height="300" fill="#b9a28a"/><path d="M400 260h160l-20 170H420Z" fill="#6c8392"/><path d="M478 270 460 120M480 260 530 150" stroke="#7b8964" stroke-width="12"/></svg>',
          ),
        },
      ])
      .png()
      .toBuffer()
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Test notebook\n',
        tempPrefix: 'chat-markup-browser-',
        day: true,
        chat: (root) => {
          fixture = fileChatHost(root)
          return fixture.host
        },
      },
      async ({ page, origin, errors }) => {
        await page.goto(`${origin}/thread/markup`)
        const composer = page.getByRole('textbox', { name: 'Message sky…', exact: true })
        await composer.waitFor()
        await composer.fill('Update this room.')
        const transfer = await page.evaluateHandle(
          (bytes) => {
            const data = new DataTransfer()
            data.items.add(new File([new Uint8Array(bytes)], 'Atlas-room.png', { type: 'image/png' }))
            return data
          },
          [...photo],
        )
        await page.locator('.sky-chat-drop-target').dispatchEvent('drop', { dataTransfer: transfer })
        await page.getByRole('button', { name: 'Mark up Atlas-room.png', exact: true }).click()
        const canvas = page.getByRole('img', { name: 'Photo annotation canvas.', exact: false })
        await canvas.waitFor()
        const box = (await canvas.boundingBox())!
        await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.3)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.75, { steps: 12 })
        await page.mouse.up()
        await page
          .getByRole('textbox', { name: 'Instruction for mark 1', exact: true })
          .fill('Make the vase cobalt blue.')
        await page
          .getByRole('textbox', { name: 'Overall instructions', exact: true })
          .fill('Keep the light and table unchanged.')
        await page.screenshot({ path: path.join(os.tmpdir(), 'sky-photo-markup-desktop.png'), fullPage: true })
        assert({
          given: 'a photo dropped into the composer and marked without sending',
          should: 'open the titled editor and keep the original prompt unsent',
          actual: [await page.title(), fixture!.calls.length],
          expected: ['sky · Mark up Atlas-room.png', 0],
        })
        await page.getByRole('button', { name: 'Done', exact: true }).click()
        await page.waitForFunction(() => !document.querySelector('.sky-chat-draft-status'))
        await page.reload()
        await page.getByRole('button', { name: 'Edit markup for Atlas-room.png', exact: true }).click()
        assert({
          given: 'a refresh before Send',
          should: 'restore editable geometry and each instruction with the same photo',
          actual: [
            await page.getByRole('textbox', { name: 'Instruction for mark 1' }).inputValue(),
            await page.getByRole('textbox', { name: 'Overall instructions' }).inputValue(),
            await canvas.locator('path').count(),
          ],
          expected: ['Make the vase cobalt blue.', 'Keep the light and table unchanged.', 1],
        })
        await page.getByRole('button', { name: '↗ Arrow', exact: true }).click()
        await page.getByRole('button', { name: 'Add mark', exact: true }).click()
        await page.getByRole('textbox', { name: 'Instruction for mark 2', exact: true }).waitFor()
        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        assert({
          given: 'an extra arrow is undone',
          should: 'keep the earlier mark and instruction',
          actual: [
            await page.getByRole('textbox', { name: 'Instruction for mark 2', exact: true }).count(),
            await page.getByRole('textbox', { name: 'Instruction for mark 1' }).inputValue(),
          ],
          expected: [0, 'Make the vase cobalt blue.'],
        })
        await page.getByRole('button', { name: 'Done', exact: true }).click()
        const baseTitle = await page.title()
        await page.route(
          '**/chat/markup/messages',
          (route) =>
            route.fulfill({
              status: 400,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'Atlas-room.png: test upload failed. Try again.' }),
            }),
          { times: 1 },
        )
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await page.getByText('Atlas-room.png: test upload failed. Try again.', { exact: true }).waitFor()
        assert({
          given: 'the service rejects an upload',
          should: 'preserve the draft text, photo and mark for retry',
          actual: [
            (await composer.innerText()).trim(),
            await page.getByRole('button', { name: 'Edit markup for Atlas-room.png', exact: true }).count(),
            fixture!.calls.length,
          ],
          expected: ['Update this room.', 1, 0],
        })
        await page.setViewportSize({ width: 390, height: 844 })
        const closeNavigation = page.getByRole('button', { name: 'Close', exact: true })
        if (await closeNavigation.isVisible()) await closeNavigation.click()
        await page.screenshot({ path: path.join(os.tmpdir(), 'sky-photo-markup-composer.png'), fullPage: true })
        await page.getByRole('button', { name: 'Edit markup for Atlas-room.png', exact: true }).click()
        await page.getByRole('textbox', { name: 'Instruction for mark 1' }).waitFor()
        await canvas.waitFor()
        await page.getByRole('button', { name: '〰 Draw', exact: true }).click()
        const phoneCanvas = (await canvas.boundingBox())!
        await page.mouse.move(phoneCanvas.x + phoneCanvas.width * 0.1, phoneCanvas.y + phoneCanvas.height * 0.2)
        await page.mouse.down()
        await page.mouse.move(phoneCanvas.x + phoneCanvas.width * 0.25, phoneCanvas.y + phoneCanvas.height * 0.4, {
          steps: 8,
        })
        await page.mouse.up()
        await page.getByRole('textbox', { name: 'Instruction for mark 2', exact: true }).waitFor()
        await page.getByRole('button', { name: 'Undo', exact: true }).click()
        await page.screenshot({ path: path.join(os.tmpdir(), 'sky-photo-markup-mobile.png'), fullPage: true })
        assert({
          given: 'the same draft on a phone',
          should: 'fit the editor without horizontal overflow',
          actual: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          expected: true,
        })
        await page.getByRole('button', { name: 'Done', exact: true }).click()
        assert({
          given: 'the markup dialog closes',
          should: 'restore the chat page title',
          actual: await page.title(),
          expected: baseTitle,
        })
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await page.getByText(FILE_CHAT_REPLY, { exact: true }).waitFor()
        const turn = fixture!.sessions.get('markup')!.turns[0]!
        assert({
          given: 'ordinary Send succeeds',
          should: 'submit the photo, numbered instruction and separate overlay once, then clear the accepted draft',
          actual: [
            fixture!.calls.length,
            splitChatFiles(turn.content).files[0]?.markup?.count,
            turn.content.includes('Make the vase cobalt blue.'),
            JSON.stringify(fixture!.calls[0]).includes('markup='),
            (await composer.innerText()).trim(),
            await page.locator('.sky-composer-shell .sky-chat-file').count(),
            errors.filter(
              (error) =>
                error !== 'console: Failed to load resource: the server responded with a status of 400 (Bad Request)',
            ),
          ],
          expected: [1, 1, true, true, '', 0, []],
        })
        await page.reload()
        await page.getByText(FILE_CHAT_REPLY, { exact: true }).waitFor()
        assert({
          given: 'the sent conversation is reloaded',
          should: 'keep the sent mark badge without reviving the draft',
          actual: [
            await page.locator('.sky-turn-user .sky-chat-markup-count').innerText(),
            await page.locator('.sky-composer-shell .sky-chat-file').count(),
          ],
          expected: [' · 1 mark', 0],
        })
        const picker = page.locator('.sky-composer-shell input[type="file"]')
        await picker.setInputFiles([
          { name: 'Atlas-room.png', mimeType: 'image/png', buffer: photo },
          { name: 'Atlas-room.png', mimeType: 'image/png', buffer: photo },
        ])
        await page.getByRole('button', { name: 'Mark up Atlas-room.png', exact: true }).last().click()
        await canvas.waitFor()
        await page.getByRole('button', { name: 'Add mark', exact: true }).click()
        await page
          .getByRole('textbox', { name: 'Instruction for mark 1', exact: true })
          .fill('Only edit the second copy.')
        await page.getByRole('button', { name: 'Done', exact: true }).click()
        await page.getByRole('button', { name: 'Remove Atlas-room.png', exact: true }).first().click()
        await page.waitForFunction(() => !document.querySelector('.sky-chat-draft-status'))
        await page.reload()
        await page.getByRole('button', { name: 'Edit markup for Atlas-room.png', exact: true }).click()
        assert({
          given: 'two identically named photos, with only the second annotated and the first removed',
          should: 'restore marks on the remaining photo rather than associate them by filename or old index',
          actual: await page.getByRole('textbox', { name: 'Instruction for mark 1', exact: true }).inputValue(),
          expected: 'Only edit the second copy.',
        })
        await page.getByRole('button', { name: 'Done', exact: true }).click()
        await page.getByRole('button', { name: 'Remove Atlas-room.png', exact: true }).click()
      },
    )
  },
)
