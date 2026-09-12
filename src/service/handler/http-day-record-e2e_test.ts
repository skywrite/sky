// Run with `bun test service/handler/http-day-record-e2e_test.ts` (a real browser).
import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { setUserSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import { dayAIChatsDir, dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import type { ThreadSummary } from './theme/client/day.tsx'

setUserSpeakerLabel('Jane')

const DAY = new PlainDate('2026-01-27')
const CHAT_DIR = path.posix.join('time', dayAIChatsDir(DAY))
const ROOT = `${CHAT_DIR}/09-00_Atlas-planning.md`
const BRANCH = `${CHAT_DIR}/09-00_Atlas-planning/10-00_Board-outline.md`
const LEAF = `${CHAT_DIR}/09-00_Atlas-planning/10-00_Board-outline/11-00_Budget [questions].md`
const VIDEO = path.posix.join('time', dayDir(DAY), 'actions/videos/Loom_Atlas.md')
const VIDEO_MD = `---
from: Jane Doe
to: Atlas Team
when: 2026-01-27 15:00 - 15:10
medium: Loom
summary: Atlas launch walkthrough
---

# Loom

## Summary

The recording walks through the launch checklist and next steps.
`

function chat(title: string, parent?: { chat: string; turn: number }): string {
  return `---
created: 2026-01-27
summary: ${title}
turns: 1
${parent ? `parent:\n  chat: ${parent.chat}\n  turn: ${parent.turn}\n` : ''}---

# ${title}

## Jane

Help me plan the next steps.

## Sky

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
        initialMarkdown: `---\ndate: ${DAY.ymd}\n---\n\n# **${DAY.ymd}**\n\n## Professional Todos\n\n-\n`,
        tempPrefix: 'day-record-',
        file: path.posix.join('time', dayFile(DAY)),
        day: true,
        files: {
          [ROOT]: chat('Atlas planning'),
          [BRANCH]: chat('Board outline', { chat: ROOT, turn: 1 }),
          [LEAF]: chat('Budget questions', { chat: BRANCH, turn: 2 }),
          [VIDEO]: VIDEO_MD,
        },
      },
      async ({ page, origin, file, errors }) => {
        let threads: ThreadSummary[] = []
        const opened: string[] = []
        await page.route('**/chat', (route) => route.fulfill({ json: { threads } }))
        await page.route('**/chat/open', (route) => {
          opened.push(route.request().postDataJSON().chat)
          return route.fulfill({ json: { id: 'continued-chat' } })
        })
        await page.route('**/chat/continued-chat', (route) =>
          route.fulfill({
            json: {
              saved: opened.at(-1),
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
          given: 'a saved video headed only Loom',
          should: 'show its summary and link to the video record from the main day column',
          actual: await videoLink.getAttribute('href'),
          expected: `/explorer/${VIDEO}`,
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
        await page.waitForURL(`${origin}/thread/continued-chat`)
        const openDocument = page.getByRole('link', { name: 'Open document', exact: true })
        await openDocument.waitFor()
        assert({
          given: 'Continue chat from the day record',
          should: 'resume the saved file and offer a link back to that document',
          actual: { opened, href: await openDocument.getAttribute('href') },
          expected: { opened: [LEAF], href: leafUrl },
        })
        await openDocument.click()
        await page.waitForURL(`${origin}${leafUrl}`)
        await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
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
          should: 'show and count only the live chat in the rail, keeping its document link',
          actual: {
            titles: await railChats.locator('.sky-dr-open').allTextContents(),
            count: await railChats.locator('.sky-rail-count').textContent(),
            href: await railParent.getByRole('link', { name: 'Atlas continued', exact: true }).getAttribute('href'),
          },
          expected: { titles: ['Atlas continued'], count: '1', href: `/explorer/${ROOT}` },
        })
        const mainParent = page.locator('.sky-day-chat').filter({ hasText: 'Atlas continued' }).first()
        assert({
          given: 'a saved chat with an active continuation',
          should: 'keep its title linked to the document',
          actual: await mainParent.getByRole('link', { name: 'Atlas continued', exact: true }).getAttribute('href'),
          expected: `/explorer/${ROOT}`,
        })
        await railParent.getByRole('button', { name: 'Continue chat', exact: true }).click()
        await page.waitForURL(`${origin}/thread/live-parent`)
        assert({
          given: 'Continue chat in the rail on an already active conversation',
          should: 'reuse its thread without opening another',
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
        await page.waitForURL(`${origin}/explorer/${VIDEO}`)
        await writeFile(
          path.join(path.dirname(file), 'actions/videos/Loom_followup.md'),
          VIDEO_MD.replace('Atlas launch walkthrough', 'Atlas follow-up'),
        )
        await page.goBack()
        await page.getByRole('link', { name: 'Atlas follow-up', exact: true }).waitFor({ state: 'visible' })

        await page.setViewportSize({ width: 430, height: 900 })
        assert({
          given: 'the day on a phone with Details closed',
          should: 'keep all chat branches in the main column',
          actual: await page.locator('.sky-day-chat').count(),
          expected: 4,
        })
        await mainLeaf.getByRole('button', { name: 'Continue chat', exact: true }).click()
        await page.waitForURL(`${origin}/thread/continued-chat`)
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
        await openDocument.click()
        await page.waitForURL(`${origin}${leafUrl}`)
        assert({ given: 'the video and chat day view', should: 'raise no page errors', actual: errors, expected: [] })
      },
    )
  },
)
