import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import ChatDocument, { setUserSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import { dayAIChatsDir, dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { fileChatHost, FILE_CHAT_REPLY } from './chat/filesTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

setUserSpeakerLabel('Jane')
test(
  {
    name: 'an older live chat follows Today, returns there after closing, and appears in both days at one saved path',
    timeout: 60000,
  },
  async (t) => {
    let root = ''
    await runWysiwygE2e(
      t,
      {
        tempPrefix: 'sky-chat-days-browser-',
        initialMarkdown: '---\nstarted: 08:00\ntz: America/Chicago\n---\n\n## Professional Todos\n\n- Check Atlas\n',
        file: path.join('time', dayFile('2026-01-28')),
        files: { [path.join('time', dayFile('2026-01-27'))]: '---\nstarted: 08:00\ntz: America/Chicago\n---\n' },
        day: true,
        dayReview: {
          status: async () => ({ pending: null, supported: true }),
          acknowledge: async () => {},
          recap: async () => {},
          summarize: async () => {
            await writeFile(
              path.join(root, 'time', dayDir('2026-01-27'), 'summary.md'),
              '---\nday: 2026-01-27\n---\n\n## Day at a Glance\n\nPlanned the Atlas pilot.\n',
            )
          },
        },
        now: new ZonedDateTime('2026-01-28 10:00', 'America/Chicago'),
        chat: (base) => {
          root = base
          return fileChatHost(
            base,
            [
              {
                id: 'ongoing-atlas',
                startTime: new PlainDateTime('2026-01-27 09:30'),
                title: 'Atlas conversation',
                state: {
                  conversation: [
                    { role: 'user', content: 'Plan the Atlas pilot.', when: '2026-01-27 09:30' },
                    { role: 'assistant', content: 'Choose the first milestone.', when: '2026-01-27 09:31' },
                  ],
                  queries: [],
                  universePaths: [],
                  lastTurn: 1,
                  contextLog: [],
                },
              },
            ],
            undefined,
            () => new PlainDateTime('2026-01-28 10:00'),
          ).host
        },
      },
      async ({ page, origin, errors }) => {
        await page.route('**/schedule', (route) => route.fulfill({ json: { read: true, errors: [], meetings: [] } }))
        await page.goto(origin)
        const link = page.locator('.sky-day-chat').getByRole('link', { name: 'Atlas conversation' })
        await link.waitFor()
        await link.click()
        await page.getByRole('button', { name: '‹ Today', exact: true }).waitFor()
        await page.getByRole('textbox', { name: 'Message sky…', exact: true }).fill('Set the pilot scope today.')
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await page.getByText(FILE_CHAT_REPLY, { exact: true }).waitFor()
        await page.getByRole('button', { name: '‹ Today', exact: true }).click()
        await page.waitForURL(origin + '/')
        await page.getByRole('button', { name: 'Review yesterday', exact: true }).click()
        const review = page.getByRole('dialog', { name: 'Review 2026-01-27' })
        await review.getByRole('button', { name: /^Chats/ }).click()
        await review.getByRole('heading', { name: 'Keep the conversation going' }).waitFor()
        await review.getByRole('button', { name: 'Open chat', exact: true }).click()
        await page.getByRole('button', { name: '‹ Day review', exact: true }).waitFor()
        await page.reload()
        await page.waitForFunction(() => document.title === 'sky:chat - Atlas conversation')
        await page.getByRole('button', { name: '‹ Day review', exact: true }).click()
        await review.getByRole('heading', { name: 'Keep the conversation going' }).waitFor()
        await page.waitForFunction(() => document.title === 'sky · Review 2026-01-27 · Chats')
        await page.goBack()
        await page.getByRole('button', { name: '‹ Day review', exact: true }).waitFor()
        await page.waitForFunction(() => document.title === 'sky:chat - Atlas conversation')
        await page.goForward()
        await review.getByRole('heading', { name: 'Keep the conversation going' }).waitFor()
        await page.waitForFunction(() => document.title === 'sky · Review 2026-01-27 · Chats')
        await review.getByRole('button', { name: 'Close for now' }).click()
        await page.goto(origin)
        await link.click()
        await page.getByRole('button', { name: '‹ Today', exact: true }).waitFor()
        const savedResponse = page.waitForResponse((response) => response.url().endsWith('/chat/ongoing-atlas/end'))
        await page.getByRole('button', { name: 'Save & close', exact: true }).click()
        await page.waitForURL(origin + '/')
        const saved = (await (await savedResponse).json()).saved as { path: string }
        await page.reload()
        const row = page.locator('.sky-day-chat').filter({ hasText: 'Atlas conversation' })
        await row.waitFor()
        const doc = ChatDocument.fromMarkdown(await readFile(saved.path, 'utf8'))
        const todayView = await (await page.request.get(origin + '/day/2026-01-28')).json()
        const firstView = await (await page.request.get(origin + '/day/2026-01-27')).json()
        assert({
          given: 'a conversation started yesterday, continued and closed from Today',
          should: 'file once under its original day and link each day’s own exchange',
          actual: [
            saved.path.startsWith(path.join(root, 'time', dayAIChatsDir('2026-01-27'))),
            doc.conversation.map((message) => message.when?.slice(0, 10)),
            todayView.chats.map((chat: { path: string; exchanges: number }) => [chat.path, chat.exchanges]),
            firstView.chats.map((chat: { path: string; exchanges: number }) => [chat.path, chat.exchanges]),
            errors,
          ],
          expected: [
            true,
            ['2026-01-27', '2026-01-27', '2026-01-28', '2026-01-28'],
            [[path.relative(root, saved.path), 1]],
            [[path.relative(root, saved.path), 1]],
            [],
          ],
        })
      },
    )
  },
)
