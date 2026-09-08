import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const QUESTION = 'What do you think of the state of the Atlas conversation?'
const SUBJECT = 'Atlas conversation status and next steps'
const CHILD_QUESTION = 'How should we plan the rollout for Widget-V2?'
const CHILD_SUBJECT = 'Widget-V2 rollout plan'
const TURNS = [
  { role: 'user', content: QUESTION },
  { role: 'assistant', content: 'Start with the next decision.' },
]

test(
  { name: 'chat subjects update the header and browser tab across streams and navigation', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Test notebook\n', tempPrefix: 'chat-titles-', day: true },
      async ({ page, origin, errors }) => {
        const firstReply = Promise.withResolvers<void>()
        const childReply = Promise.withResolvers<void>()
        const childFinished = Promise.withResolvers<void>()
        const refreshed = Promise.withResolvers<void>()
        let listReads = 0
        let named = false
        let childNamed = false
        let staleList = true
        const settings = {
          model: {
            current: 'test',
            default: 'test',
            choices: [{ name: 'test', label: 'Test model', provider: 'Test', roles: ['Thinking'] }],
          },
          contextTokens: 0,
          saves: false,
          kept: 0,
          documents: 0,
        }
        await page.route('**/chat', async (route) => {
          await route.fulfill({
            json: {
              threads: [
                ...(named ? [{ id: 'parent', title: staleList ? QUESTION : SUBJECT }] : []),
                ...(childNamed ? [{ id: 'child', title: CHILD_SUBJECT }] : []),
              ].map((thread) => ({
                ...thread,
                day: '2026-01-27',
                when: '09:30',
                state: 'done',
                line: 'Start with the next decision.',
                turns: 2,
                busy: false,
                saves: false,
                parent: null,
                inherited: 0,
                saved: null,
              })),
            },
          })
          listReads++
          if (named && staleList) refreshed.resolve()
        })
        await page.route('**/chat/**', async (route) => {
          const pathname = new URL(route.request().url()).pathname
          const child = pathname.startsWith('/chat/child')
          if (pathname.endsWith('/settings')) return route.fulfill({ json: settings })
          if (pathname.endsWith('/branch')) return route.fulfill({ status: 201, json: { id: 'child' } })
          if (pathname.endsWith('/messages')) {
            await (child ? childReply.promise : firstReply.promise)
            if (child) childNamed = true
            else named = true
            const title = child ? CHILD_SUBJECT : SUBJECT
            await route.fulfill({
              contentType: 'text/event-stream',
              body: [
                `event: title\ndata: ${JSON.stringify({ title })}\n\n`,
                `event: turn\ndata: ${JSON.stringify({ text: 'Start with the next decision.', branchPoint: { turn: 1, key: 'first-reply' } })}\n\n`,
              ].join(''),
            })
            if (child) childFinished.resolve()
            return
          }
          return route.fulfill({
            json: {
              title: child ? (childNamed ? CHILD_SUBJECT : null) : named ? SUBJECT : null,
              turns: child
                ? [...TURNS, ...(childNamed ? [{ role: 'user', content: CHILD_QUESTION }, TURNS[1]] : [])]
                : named
                  ? TURNS
                  : [],
              branchPoints: [null, { turn: 1, key: 'first-reply' }],
              documents: 0,
              kept: 0,
              busy: false,
              inherited: child ? 2 : 0,
              parent: child ? { id: 'parent', chat: 'mock-parent.md', turn: 1, title: SUBJECT } : null,
            },
          })
        })
        try {
          await page.goto(`${origin}/thread/parent`)
          await page.waitForFunction(() => document.title === 'sky:chat - New chat')
          const composer = page.getByRole('textbox', { name: 'Message sky…', exact: true })
          await composer.fill(QUESTION)
          await page.getByRole('button', { name: 'Send', exact: true }).click()
          await page.waitForFunction((question) => document.title === `sky:chat - ${question}`, QUESTION)
          assert({
            given: 'an opening question whose subject falls after the first eight words',
            should: 'retain the full question while its subject is pending',
            actual: await page.locator('.sky-chat-head .sky-title').textContent(),
            expected: QUESTION,
          })
          firstReply.resolve()
          await page.waitForFunction((subject) => document.title === `sky:chat - ${subject}`, SUBJECT)
          await refreshed.promise
          assert({
            given: 'a streamed subject followed by a stale thread-list refresh',
            should: 'keep the subject in both the header and tab',
            actual: {
              header: await page.locator('.sky-chat-head .sky-title').textContent(),
              hover: await page.locator('.sky-chat-head .sky-title').getAttribute('title'),
              tab: await page.title(),
              polled: listReads > 1,
            },
            expected: { header: SUBJECT, hover: SUBJECT, tab: `sky:chat - ${SUBJECT}`, polled: true },
          })
          staleList = false
          await page.reload()
          await page.waitForFunction((subject) => document.title === `sky:chat - ${subject}`, SUBJECT)
          await page.evaluate(() => {
            window.open = () => null
          })
          await page.getByRole('button', { name: 'New chat from here…', exact: true }).click()
          await page.waitForURL(`${origin}/thread/child`)
          await page.waitForFunction(() => document.title === 'sky:chat - New branch')
          await composer.fill(CHILD_QUESTION)
          await page.getByRole('button', { name: 'Send', exact: true }).click()
          await page.waitForFunction((question) => document.title === `sky:chat - ${question}`, CHILD_QUESTION)
          await page.getByRole('button', { name: '‹ Today', exact: true }).click()
          await page.waitForFunction(() => document.title === 'sky')
          childReply.resolve()
          await childFinished.promise
          // Wait for the delivered stream to be consumed after navigation.
          await page.waitForResponse((response) => new URL(response.url()).pathname === '/chat')
          assert({
            given: 'a branch subject arrives after leaving the chat',
            should: 'leave the destination tab title intact',
            actual: await page.title(),
            expected: 'sky',
          })
          await page.goBack()
          await page.waitForFunction((subject) => document.title === `sky:chat - ${subject}`, CHILD_SUBJECT)
          assert({
            given: 'returning to a named branch',
            should: 'show its own subject with no browser errors',
            actual: { header: await page.locator('.sky-chat-head .sky-title').textContent(), errors },
            expected: { header: CHILD_SUBJECT, errors: [] },
          })
        } finally {
          firstReply.resolve()
          childReply.resolve()
        }
      },
    )
  },
)
