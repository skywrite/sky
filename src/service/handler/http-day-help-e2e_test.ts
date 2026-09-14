import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import dayFile from '#shared/nbfs/dayFile.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { replyThreadTestHost } from './chat/replyThreadsTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2026-02-04')
const FILE = path.posix.join('time', dayFile(DAY))
const DOCUMENT = 'projects/Atlas/Proposal Draft.md'
const LINK = path.posix.relative(path.posix.dirname(FILE), DOCUMENT).replaceAll(' ', '%20')
const MARKDOWN = `---
date: ${DAY.ymd}
---

## Most Important

- Review [Atlas proposal](${LINK}#next-steps)
  Confirm the launch date before drafting the response.

## Professional Commitments

- 10:30 > Prepare for the team meeting

## Personal Todos

- Book a plumber

## Reminders

- Water the plants
`
const REPLY = 'I can help with the next step.'

test(
  { name: 'day — Sky help drafts each kind of item in a temporary chat; sending is the person’s', timeout: 90000 },
  async (t) => {
    let modelCalls = 0
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: MARKDOWN,
        tempPrefix: 'day-help-',
        file: FILE,
        files: { [DOCUMENT]: '# Atlas proposal\n\n## Next steps\n\nReview the draft.\n' },
        day: true,
        chat: (root) =>
          replyThreadTestHost(root, {
            invokeModel: async ({ sink }) => {
              modelCalls++
              sink.write(REPLY)
              return { text: REPLY, content: [], steps: [], responseMessages: [{ role: 'assistant', content: REPLY }] }
            },
          }),
      },
      async ({ page, origin, file, errors }) => {
        const sent: Array<{ message: string; saves: boolean; profile: string; contextTokens: number }> = []
        page.on('request', (request) => {
          if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/messages'))
            sent.push(request.postDataJSON())
        })
        const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
        const composer = page.getByRole('textbox', { name: 'Message sky…', exact: true })
        // Enabled: the page has loaded the thread and its settings, so a click ends the right thing.
        const discard = page.getByRole('button', { name: 'Discard', exact: true, disabled: false })
        const temporary = page.locator('.sky-main[data-temporary="true"]')
        const items = [
          { text: 'Review Atlas proposal', section: 'Most Important' },
          { text: 'Prepare for the team meeting', section: 'Professional Commitments' },
          { text: 'Book a plumber', section: 'Personal Todos' },
          { text: 'Water the plants', section: 'Reminders' },
        ]
        /** Opens the item's help chat from the day and answers its thread id. */
        const openHelp = async (item: { text: string }, index: number) => {
          await page.goto(`${origin}/${DAY.ymd}`)
          const row = page.locator('.sky-prow').filter({ hasText: item.text })
          const help = row.getByRole('button', { name: 'Get Sky’s help', exact: true })
          await help.waitFor({ state: 'visible' })
          if (screenshot && (index === 0 || index === 2)) {
            await row.hover()
            await page.screenshot({ path: `${screenshot}-${index === 0 ? 'desktop' : 'mobile'}.png`, fullPage: true })
          }
          if (index === 0) {
            await help.focus()
            await page.keyboard.press('Enter')
          } else await help.click()
          await page.waitForURL(`${origin}/thread/*`)
          await discard.waitFor({ state: 'visible' })
          await temporary.waitFor()
          return new URL(page.url()).pathname.split('/').at(-1)!
        }
        for (const [index, item] of items.entries()) {
          await page.setViewportSize(index === 2 ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
          let id = await openHelp(item, index)
          const draft = await composer.inputValue()
          if (screenshot && (index === 0 || index === 2)) {
            await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ state: 'visible' })
            await page.screenshot({
              path: `${screenshot}-draft-${index === 0 ? 'desktop' : 'mobile'}.png`,
              fullPage: true,
            })
          }
          assert({
            given: `${item.section} opened with Sky help`,
            should: 'hold the request in the composer of a temporary chat without sending it',
            actual: {
              message: draft.startsWith(`Help me get this done: ${item.text}\n`),
              section: draft.includes(`From ${item.section} on ${DAY.ymd}`),
              source: draft.includes(`/explorer/${FILE}`),
              temporary: await temporary.count(),
              requests: sent.length,
              calls: modelCalls,
            },
            expected: { message: true, section: true, source: true, temporary: 1, requests: index, calls: index },
          })
          if (index === 0) {
            assert({
              given: 'an item with notes and a relative document link',
              should: 'carry the notes and a resolved link including its fragment',
              actual: {
                notes: draft.includes('Confirm the launch date before drafting the response.'),
                link: draft.includes('/explorer/projects/Atlas/Proposal%20Draft.md#next-steps'),
              },
              expected: { notes: true, link: true },
            })
            await page.reload()
            await discard.waitFor({ state: 'visible' })
            assert({
              given: 'a refreshed help chat with nothing sent',
              should: 'keep the request in the composer and stay temporary',
              actual: { draft: await composer.inputValue(), temporary: await temporary.count(), calls: modelCalls },
              expected: { draft, temporary: 1, calls: 0 },
            })
            await discard.click()
            await page.waitForURL(`${origin}/`)
            await page.locator('.sky-chat-close-toast').filter({ hasText: 'Chat discarded' }).waitFor()
            const settings = await (await page.request.get(`${origin}/chat/${id}/settings`)).json()
            assert({
              given: 'the unsent help chat discarded',
              should: 'forget its temporary setting and its draft, having sent nothing',
              actual: {
                saves: settings.saves,
                chatStatus: (await page.request.get(`${origin}/chat/${id}`)).status(),
                stored: await page.evaluate((key) => localStorage.getItem(key), `sky-chat-draft:${id}`),
                requests: sent.length,
                markdown: await readFile(file, 'utf8'),
              },
              expected: { saves: true, chatStatus: 404, stored: null, requests: 0, markdown: MARKDOWN },
            })
            id = await openHelp(item, index)
          }
          await page.getByRole('button', { name: 'Send', exact: true }).click()
          await page.getByText(REPLY, { exact: true }).waitFor()
          const body = sent.at(-1)!
          assert({
            given: `${item.section} sent from the composer`,
            should: 'send the request once with the thread model and saving off',
            actual: {
              message: body.message === draft,
              saves: body.saves,
              profile: body.profile,
              contextTokens: body.contextTokens,
              calls: modelCalls,
              requests: sent.length,
              draft: await composer.inputValue(),
            },
            expected: {
              message: true,
              saves: false,
              profile: 'test-thread-model',
              contextTokens: 0,
              calls: index + 1,
              requests: index + 1,
              draft: '',
            },
          })
          if (index === 0) {
            assert({
              given: 'the sent request on the page',
              should: 'link the copied document from the source day',
              actual: await page
                .getByRole('link', { name: 'Atlas proposal', exact: true })
                .first()
                .getAttribute('href'),
              expected: '/explorer/projects/Atlas/Proposal%20Draft.md#next-steps',
            })
            await page.reload()
            await page.getByText(REPLY, { exact: true }).waitFor()
            assert({
              given: 'a refreshed item-help chat',
              should: 'remain temporary without sending the opening message again',
              actual: { calls: modelCalls, discard: await discard.isVisible() },
              expected: { calls: 1, discard: true },
            })
          }
          await discard.click()
          await page.waitForURL(`${origin}/`)
          await page.locator('.sky-chat-close-toast').filter({ hasText: 'Chat discarded' }).waitFor()
          assert({
            given: 'the item-help conversation discarded',
            should: 'leave the original day unchanged and remove the active chat',
            actual: {
              markdown: await readFile(file, 'utf8'),
              chatStatus: (await page.request.get(`${origin}/chat/${id}`)).status(),
            },
            expected: { markdown: MARKDOWN, chatStatus: 404 },
          })
        }
        const defaults = await (await page.request.get(`${origin}/chat/new-normal-chat/settings`)).json()
        assert({
          given: 'four temporary item-help chats',
          should: 'leave normal chat saving enabled and produce no browser errors',
          actual: { saves: defaults.saves, errors },
          expected: { saves: true, errors: [] },
        })
      },
    )
  },
)

test({ name: 'day — an unavailable temporary chat leaves the item in place for retry', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    { initialMarkdown: MARKDOWN, tempPrefix: 'day-help-unavailable-', file: FILE, day: true },
    async ({ page, origin, file }) => {
      let requests = 0
      await page.route('**/chat/*/settings', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        requests++
        return route.fulfill({ status: 503, json: { message: 'Temporary chats are unavailable. Try again.' } })
      })
      await page.goto(`${origin}/${DAY.ymd}`)
      const help = page
        .locator('.sky-prow')
        .filter({ hasText: 'Book a plumber' })
        .getByRole('button', { name: 'Get Sky’s help', exact: true })
      await help.click()
      await page.getByRole('alert').getByText('Temporary chats are unavailable. Try again.').waitFor()
      assert({
        given: 'temporary chat setup fails',
        should: 'show the failure beside the unchanged day and allow another attempt',
        actual: {
          route: new URL(page.url()).pathname,
          enabled: await help.isEnabled(),
          markdown: await readFile(file, 'utf8'),
        },
        expected: { route: `/${DAY.ymd}`, enabled: true, markdown: MARKDOWN },
      })
      await help.click()
      await page.getByRole('alert').getByText('Temporary chats are unavailable. Try again.').waitFor()
      assert({ given: 'a retry', should: 'try again', actual: requests, expected: 2 })
    },
  )
})
