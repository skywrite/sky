import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const THREAD = 'atlas-links'
const BRIEF = 'projects/Atlas/Brief.md'
const SAVED_BRANCH = 'projects/Atlas/Board-outline.md'
const REPLY = [
  'Read [the Atlas brief](/explorer/projects/Atlas/Brief.md) and [the status page](https://example.com/status).',
  '',
  'The [checklist below](#checklist) has the rest.',
].join('\n')

function thread(title: string, reply: string) {
  return {
    title,
    turns: [
      { role: 'user', content: 'Where do I start?' },
      { role: 'assistant', content: reply },
    ],
    branchPoints: [null, { turn: 1, key: `${title}-1` }],
    documents: 0,
    kept: 0,
    busy: false,
    inherited: 0,
    parent: null,
  }
}

test(
  { name: 'links in a chat open in a new tab and leave the conversation where it is', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Test notebook\n',
        tempPrefix: 'chat-links-',
        day: true,
        // A browser's ordinary rules: a page opens a tab only inside the person's click.
        popupBlocking: true,
        files: { [BRIEF]: '# Atlas brief\n\nThe launch plan.\n' },
      },
      async ({ page, origin, errors }) => {
        const context = page.context()
        let tabs = 0
        context.on('page', (tab) => {
          tabs++
          tab.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
        })
        const opened: string[] = []
        await context.route('https://example.com/**', (route) =>
          route.fulfill({ contentType: 'text/html', body: '<title>Status</title><p>All systems normal.</p>' }),
        )
        await context.route('**/chat', (route) => route.fulfill({ json: { threads: [] } }))
        await context.route(`**/chat/${THREAD}`, (route) =>
          route.fulfill({
            json: {
              ...thread('Atlas links', REPLY),
              branches: [{ chat: SAVED_BRANCH, title: 'Board outline', turn: 1 }],
            },
          }),
        )
        await context.route('**/chat/board-outline', (route) =>
          route.fulfill({ json: thread('Board outline', 'Start with the agenda.') }),
        )
        await context.route('**/chat/open', (route) => {
          opened.push(route.request().postDataJSON().chat)
          return route.fulfill({ json: { id: 'board-outline' } })
        })
        await context.route('**/chat/*/settings', (route) =>
          route.fulfill({
            json: {
              model: {
                current: 'test',
                default: 'test',
                choices: [{ name: 'test', label: 'Test model', provider: 'Test', roles: [] }],
              },
              contextTokens: 0,
              saves: false,
            },
          }),
        )
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/thread/${THREAD}`)
        const reply = page.locator('.sky-body.sky-rendered').first()
        await reply.getByRole('link', { name: 'checklist below', exact: true }).click()
        await page.waitForURL(`${origin}/thread/${THREAD}#checklist`)

        const chatUrl = page.url()
        const chatTitle = await page.title()
        const chatDocument = await page.evaluateHandle(() => document)
        const chat = async () => ({
          url: page.url(),
          title: await page.title(),
          sameDocument: await page.evaluate((before) => document === before, chatDocument),
        })
        const unchanged = { url: chatUrl, title: chatTitle, sameDocument: true }

        const briefTab = context.waitForEvent('page')
        await reply.getByRole('link', { name: 'the Atlas brief', exact: true }).click()
        const brief = await briefTab
        await brief.waitForURL(`${origin}/explorer/${BRIEF}`)
        await brief.getByText('The launch plan.', { exact: true }).waitFor()
        assert({
          given: 'an ordinary click on a notebook link in a reply',
          should: 'open the document in a new tab and keep the conversation where it is',
          actual: await chat(),
          expected: unchanged,
        })
        await brief.close()

        const statusTab = context.waitForEvent('page')
        await reply.getByRole('link', { name: 'the status page', exact: true }).click()
        const status = await statusTab
        await status.waitForURL('https://example.com/status')
        assert({
          given: 'an ordinary click on a web link in a reply',
          should: 'open the site in a new tab that cannot reach back into the chat',
          actual: { noOpener: await status.evaluate(() => window.opener === null), chat: await chat() },
          expected: { noOpener: true, chat: unchanged },
        })
        await status.close()

        const branchTab = context.waitForEvent('page')
        await page.getByRole('button', { name: 'Board outline', exact: true }).click()
        const branch = await branchTab
        await branch.waitForURL(`${origin}/thread/board-outline`)
        await branch.getByText('Start with the agenda.', { exact: true }).waitFor()
        assert({
          given: 'a saved branch named under the reply',
          should: 'continue it in a new tab and keep this conversation where it is',
          actual: { opened, chat: await chat() },
          expected: { opened: [SAVED_BRANCH], chat: unchanged },
        })
        await branch.close()
        await chatDocument.dispose()

        assert({
          given: 'a jump within the reply, then three links',
          should: 'open one tab per link and none for the jump',
          actual: tabs,
          expected: 3,
        })
        assert({
          given: 'the chat and the tabs it opened',
          should: 'raise no page errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)
