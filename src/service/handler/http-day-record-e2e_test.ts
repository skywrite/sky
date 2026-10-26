// Run with `bun test service/handler/http-day-record-e2e_test.ts` (a real browser).
import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { setUserSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import { dayAIChatsDir, dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ThreadSummary } from '../../web/client/day/day.tsx'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

setUserSpeakerLabel('Jane')

const DAY = new PlainDate('2026-01-27')
const CHAT_DIR = path.posix.join('time', dayAIChatsDir(DAY))
const ROOT = `${CHAT_DIR}/09-00_Atlas-planning.md`
const BRANCH = `${CHAT_DIR}/09-00_Atlas-planning/10-00_Board-outline.md`
const LEAF = `${CHAT_DIR}/09-00_Atlas-planning/10-00_Board-outline/11-00_Budget [questions].md`
const VIDEO = path.posix.join('time', dayDir(DAY), 'actions/videos/Zoom Clip_Atlas.md')
const VIDEO_URL = `/explorer/${VIDEO.split('/').map(encodeURIComponent).join('/')}`
const EARLIER = new PlainDate('2026-01-26')
const EARLIER_CHAT = path.posix.join('time', dayAIChatsDir(EARLIER), '09-00_Atlas-kickoff.md')
const VIDEO_MD = `---
from: Jane Doe
to: Atlas Team
when: 2026-01-27 15:00 - 15:10
medium: Zoom Clip
summary: Atlas launch walkthrough
---

# Zoom Clip

## Summary

The recording walks through the launch checklist and next steps.
`

function chat(title: string, parent?: { chat: string; turn: number }, created = DAY.ymd): string {
  return `---
created: ${created}
summary: ${title}
turns: 1
${parent ? `parent:\n  chat: ${parent.chat}\n  turn: ${parent.turn}\n` : ''}---

# ${title}

## Conversation

### **Jane**

Help me plan the next steps.

### **Sky**

Start with a short checklist and assign each action.
`
}

test(
  {
    name: 'day shows videos and every chat branch in the main column with only live chats in the rail',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: `---
date: ${DAY.ymd}
---

# **${DAY.ymd}**

## Professional Todos

-

## Professional Complete

- 15:00 > Jane Doe to Atlas Team Zoom Clip -> [Atlas launch walkthrough](actions/videos/Zoom Clip_Atlas.md)
- 16:00 > Garden -> Planted the beds
`,
        tempPrefix: 'day-record-',
        file: path.posix.join('time', dayFile(DAY)),
        day: true,
        // The day under test is today; the earlier day's chat must read as another day's.
        now: new ZonedDateTime('2026-01-27T12:00:00', 'UTC'),
        files: {
          [ROOT]: chat('Atlas planning'),
          [BRANCH]: chat('Board outline', { chat: ROOT, turn: 1 }),
          [LEAF]: chat('Budget questions', { chat: BRANCH, turn: 2 }),
          [VIDEO]: VIDEO_MD,
          [path.posix.join('time', dayFile(EARLIER))]: `---\ndate: ${EARLIER.ymd}\n---\n\n# **${EARLIER.ymd}**\n`,
          [EARLIER_CHAT]: chat('Atlas kickoff', undefined, EARLIER.ymd),
        },
      },
      async ({ page, origin, file, errors }) => {
        let threads: ThreadSummary[] = []
        const opened: string[] = []
        await page.route('**/chat', (route) => route.fulfill({ json: { threads } }))
        await page.route('**/chat/open', (route) => {
          const chat = route.request().postDataJSON().chat
          opened.push(chat)
          return route.fulfill({ json: { id: chat === EARLIER_CHAT ? 'earlier-chat' : 'continued-chat' } })
        })
        await page.route('**/chat/continued-chat', (route) =>
          route.fulfill({
            json: {
              saved: opened.at(-1),
              day: DAY.ymd,
              turns: [
                { role: 'user', content: 'Help me plan the next steps.' },
                { role: 'assistant', content: 'Start with a short checklist and assign each action.' },
              ],
              documents: 0,
              kept: 0,
              busy: false,
            },
          }),
        )
        await page.route('**/chat/earlier-chat', (route) =>
          route.fulfill({
            json: {
              saved: EARLIER_CHAT,
              day: EARLIER.ymd,
              turns: [
                { role: 'user', content: 'Help me plan the next steps.' },
                { role: 'assistant', content: 'Start with a short checklist and assign each action.' },
              ],
              documents: 0,
              kept: 0,
              busy: false,
            },
          }),
        )
        const ended: Array<{ save: boolean }> = []
        await page.route('**/chat/earlier-chat/end', (route) => {
          ended.push(route.request().postDataJSON())
          return route.fulfill({ json: { saved: { summary: 'Atlas kickoff', exchanges: 1 }, ended: ['earlier-chat'] } })
        })
        await page.route('**/chat/*/settings', (route) =>
          route.fulfill({
            json: {
              model: {
                current: 'test',
                default: 'test',
                choices: [{ name: 'test', label: 'Test model', provider: 'Test', roles: [] }],
              },
              contextTokens: 0,
              saves: true,
            },
          }),
        )
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.waitForSelector('.sky-day-chat:has-text("Budget questions")')
        const rows = () =>
          page.locator('.sky-day-chat').evaluateAll((elements) =>
            elements.map((element) => ({
              title: element.querySelector('.sky-day-chat-open')?.textContent,
              depth: element.getAttribute('data-depth'),
              detail: element.querySelector('.sky-day-chat-meta')?.textContent,
            })),
          )
        assert({
          given: 'a saved chat, its branch, and a branch nested another directory deep',
          should: 'show all three under their parents with their own turn counts and branch points',
          actual: await rows(),
          expected: [
            { title: 'Atlas planning', depth: '0', detail: '1 turn' },
            { title: 'Board outline', depth: '1', detail: '1 new turn · from turn 1 of Atlas planning' },
            { title: 'Budget questions', depth: '2', detail: '1 new turn · from turn 2 of Board outline' },
          ],
        })
        assert({
          given: 'the Details rail beside a day with only saved chats',
          should: 'show the live-chat empty state without saved rows or a count',
          actual: {
            rows: await page.locator('.sky-rail [data-section="chats"] .sky-dr-item').count(),
            empty: await page.locator('.sky-rail [data-section="chats"] .sky-rail-empty').textContent(),
            counts: await page.locator('.sky-rail [data-section="chats"] .sky-rail-count').count(),
          },
          expected: { rows: 0, empty: 'No live chats.', counts: 0 },
        })
        const videoLink = page.getByRole('link', { name: 'Atlas launch walkthrough', exact: true })
        assert({
          given: 'a saved video headed only Zoom Clip',
          should: 'show its summary and link to the video record from the main day column',
          actual: await videoLink.getAttribute('href'),
          expected: VIDEO_URL,
        })
        const done = page.locator('.sky-block').filter({ has: page.locator('.sky-bhead', { hasText: 'Done today' }) })
        assert({
          given: 'the video’s legacy capture log with a space in its link destination',
          should: 'hide the capture log from Done today without hiding an ordinary activity with an arrow',
          actual: await done.locator('.sky-done-text').allTextContents(),
          expected: ['Garden -> Planted the beds'],
        })

        const leafUrl = `/explorer/${LEAF.split('/').map(encodeURIComponent).join('/')}`
        const mainLeaf = page.locator('.sky-day-chat').filter({ hasText: 'Budget questions' })
        assert({
          given: 'a saved branch whose filename contains spaces and brackets',
          should: 'link its title to the encoded document URL in the main column',
          actual: await mainLeaf.getByRole('link', { name: 'Budget questions', exact: true }).getAttribute('href'),
          expected: leafUrl,
        })
        await mainLeaf.getByRole('link', { name: 'Budget questions', exact: true }).click()
        await page.waitForURL(`${origin}${leafUrl}`)
        await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
        assert({
          given: 'clicking a saved title from the day',
          should: 'open the notebook document without starting a conversation',
          actual: opened,
          expected: [],
        })
        await page.goBack()
        await mainLeaf.getByRole('button', { name: 'Continue chat', exact: true }).click()
        await page.waitForURL(`${origin}/thread/continued-chat?returnTo=%2F`)
        const openDocument = page.getByRole('link', { name: 'Open document', exact: true })
        await openDocument.waitFor()
        assert({
          given: 'Continue chat from the day record',
          should: 'resume the saved file and offer a link back to that document',
          actual: { opened, href: await openDocument.getAttribute('href') },
          expected: { opened: [LEAF], href: leafUrl },
        })
        const documentTab = page.waitForEvent('popup')
        await openDocument.click()
        const tab = await documentTab
        await tab.waitForURL(`${origin}${leafUrl}`)
        await tab.getByRole('button', { name: 'Edit', exact: true }).waitFor()
        assert({
          given: 'Open document clicked in the conversation header',
          should: 'open the document in a new tab and keep the conversation where it is',
          actual: page.url(),
          expected: `${origin}/thread/continued-chat?returnTo=%2F`,
        })
        await tab.close()
        await page.goto(`${origin}/${DAY.ymd}`)

        threads = [
          {
            id: 'live-parent',
            title: 'Atlas continued',
            day: DAY.ymd,
            when: '12:00',
            state: 'done',
            line: null,
            turns: 4,
            inherited: 0,
            saved: ROOT,
            parent: null,
            busy: false,
          },
        ]
        await page.waitForSelector('.sky-day-chat-open:has-text("Atlas continued")')
        assert({
          given: 'the parent now open as a live conversation',
          should: 'replace its saved row while retaining both saved descendants',
          actual: (await rows()).map((row) => [row.title, row.depth]),
          expected: [
            ['Atlas continued', '0'],
            ['Board outline', '1'],
            ['Budget questions', '2'],
          ],
        })
        const railChats = page.locator('.sky-rail [data-section="chats"]')
        const railParent = railChats.locator('.sky-dr-item')
        assert({
          given: 'one live continuation alongside two saved branches',
          should: 'show and count only the live chat in the rail, its title opening the conversation',
          actual: {
            titles: await railChats.locator('.sky-dr-open').allTextContents(),
            count: await railChats.locator('.sky-rail-count').textContent(),
            href: await railParent.getByRole('link', { name: 'Atlas continued', exact: true }).getAttribute('href'),
            resume: await railParent.getByRole('button', { name: 'Continue chat', exact: true }).count(),
          },
          expected: { titles: ['Atlas continued'], count: '1', href: '/thread/live-parent?returnTo=%2F', resume: 0 },
        })
        const mainParent = page.locator('.sky-day-chat').filter({ hasText: 'Atlas continued' }).first()
        assert({
          given: 'a saved chat with an active continuation',
          should: 'link its title to the open conversation, with no Continue chat beside it',
          actual: {
            href: await mainParent.getByRole('link', { name: 'Atlas continued', exact: true }).getAttribute('href'),
            resume: await mainParent.getByRole('button', { name: 'Continue chat', exact: true }).count(),
          },
          expected: { href: '/thread/live-parent?returnTo=%2F', resume: 0 },
        })
        await railParent.getByRole('link', { name: 'Atlas continued', exact: true }).click()
        await page.waitForURL(`${origin}/thread/live-parent?returnTo=%2F`)
        assert({
          given: 'the title of an already active conversation clicked in the rail',
          should: 'open its thread without opening another',
          actual: opened,
          expected: [LEAF],
        })
        await page.goto(`${origin}/${DAY.ymd}`)

        await writeFile(
          path.join(path.dirname(file), 'actions/ai-chats/13-00_Atlas-follow-up.md'),
          chat('Atlas follow-up chat'),
        )
        threads = []
        await page.waitForSelector('.sky-day-chat-open:has-text("Atlas follow-up chat")')
        assert({
          given: 'the live chat closes and the day refreshes',
          should: 'remove it from the rail while the saved record stays in the main column',
          actual: {
            liveRows: await railChats.locator('.sky-dr-item').count(),
            savedRows: await page.locator('.sky-day-chat').count(),
          },
          expected: { liveRows: 0, savedRows: 4 },
        })

        await videoLink.click()
        await page.waitForURL(`${origin}${VIDEO_URL}`)
        await writeFile(
          path.join(path.dirname(file), 'actions/videos/Loom_followup.md'),
          VIDEO_MD.replace('Atlas launch walkthrough', 'Atlas follow-up'),
        )
        await page.goBack()
        await page.getByRole('link', { name: 'Atlas follow-up', exact: true }).waitFor({ state: 'visible' })
        assert({
          given: 'returning to the day after opening a video',
          should: 'keep the legacy capture out of Done today after the record refreshes',
          actual: await done.locator('.sky-done-text').allTextContents(),
          expected: ['Garden -> Planted the beds'],
        })

        await page.setViewportSize({ width: 430, height: 900 })
        assert({
          given: 'the day on a phone with Details closed',
          should: 'keep all chat branches in the main column',
          actual: await page.locator('.sky-day-chat').count(),
          expected: 4,
        })
        await mainLeaf.getByRole('button', { name: 'Continue chat', exact: true }).click()
        await page.waitForURL(`${origin}/thread/continued-chat?returnTo=%2F`)
        await openDocument.waitFor()
        assert({
          given: 'the conversation header on a phone',
          should: 'keep the document link within the viewport',
          actual: await openDocument.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            const label = element.querySelector('.mantine-Button-label')
            return (
              rect.left >= 0 &&
              rect.right <= window.innerWidth &&
              Boolean(label && label.clientWidth >= label.scrollWidth)
            )
          }),
          expected: true,
        })
        const phoneTab = page.waitForEvent('popup')
        await openDocument.click()
        const phoneDocument = await phoneTab
        await phoneDocument.waitForURL(`${origin}${leafUrl}`)
        await phoneDocument.close()

        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/${EARLIER.ymd}`)
        await page
          .locator('.sky-day-chat')
          .filter({ hasText: 'Atlas kickoff' })
          .getByRole('button', { name: 'Continue chat', exact: true })
          .click()
        await page.waitForURL(`${origin}/thread/earlier-chat?returnTo=${encodeURIComponent(`/${EARLIER.ymd}`)}`)
        await page.getByRole('button', { name: 'Mon, Jan 26' }).waitFor()
        await page.getByRole('button', { name: 'Save & close', exact: true, disabled: false }).click()
        await page.waitForURL(`${origin}/${EARLIER.ymd}`)
        await page.locator('.sky-chat-close-toast').filter({ hasText: 'Chat saved' }).waitFor()
        assert({
          given: 'a chat continued from an earlier day, saved and closed',
          should: 'name that day on the way back, and return to it with the save noted there',
          actual: { ended, path: new URL(page.url()).pathname },
          expected: { ended: [{ save: true }], path: `/${EARLIER.ymd}` },
        })
        assert({ given: 'the video and chat day view', should: 'raise no page errors', actual: errors, expected: [] })
      },
    )
  },
)
