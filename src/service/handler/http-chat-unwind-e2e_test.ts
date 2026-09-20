import { assert, test } from '#test'
import { replyThreadTestHost } from './chat/replyThreadsTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const USAGE = {
  inputTokens: 8,
  outputTokens: 2,
  totalTokens: 10,
  inputTokenDetails: { noCacheTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokenDetails: { textTokens: 2, reasoningTokens: 0 },
}

test(
  {
    name: 'delete from here confirms under the question, cuts the chat, and hands the question back',
    timeout: 60000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Test notebook\n',
        tempPrefix: 'sky-unwind-ui-',
        day: true,
        chat: (base) =>
          replyThreadTestHost(base, {
            // Each reply says which question it answers, so a cut and a re-ask are told apart.
            invokeModel: async (args) => {
              const text = `Answer ${args.messages.filter((message) => message.role === 'user').length}.`
              args.sink.write(text)
              return {
                text,
                content: [],
                steps: [],
                responseMessages: [{ role: 'assistant', content: text }],
                usage: USAGE,
              }
            },
          }),
      },
      async ({ page, origin, errors }) => {
        await page.setViewportSize({ width: 1360, height: 940 })
        await page.goto(`${origin}/thread/atlas`)
        const composer = page.getByRole('textbox', { name: 'Message sky…', exact: true })
        const ask = async (message: string, answer: string) => {
          await composer.fill(message)
          await page.getByRole('button', { name: 'Send', exact: true }).click()
          await page.getByText(answer, { exact: true }).last().waitFor()
        }
        await ask('Plan the Atlas launch.', 'Answer 1.')
        await ask('Draft the Atlas announcement.', 'Answer 2.')
        await ask('Post the Atlas announcement.', 'Answer 3.')
        const menus = page.getByRole('button', { name: 'Message options', exact: true })
        const note = page.getByRole('group', { name: 'Delete from here', exact: true })
        const held = async () => ((await (await page.request.get(`${origin}/chat/atlas`)).json()) as any).turns.length

        await menus.nth(1).click()
        await page.getByRole('menuitem', { name: 'Delete from here…', exact: true }).click()
        await note.waitFor()
        assert({
          given: 'Delete from here… chosen on the second of three questions',
          should: 'ask under that question, say what goes, draw it faint, and leave Delete unfocused',
          actual: {
            menus: await menus.count(),
            says: await note.locator('.sky-unwind-line').first().innerText(),
            faint: await page.locator('.sky-turn[data-going]').count(),
            first: await page.locator('.sky-turn').first().getAttribute('data-going'),
            // A repeated Enter from the menu must never land on Delete.
            deleteFocused: await note
              .getByRole('button', { name: 'Delete', exact: true })
              .evaluate((element) => element === document.activeElement),
          },
          expected: {
            menus: 3,
            says: '2 questions and 2 replies go. Your question comes back into the box.',
            faint: 4,
            first: null,
            deleteFocused: false,
          },
        })

        await page.keyboard.press('Escape')
        await note.waitFor({ state: 'detached' })
        assert({
          given: 'Escape on the confirm',
          should: 'close it and delete nothing',
          actual: { turns: await page.locator('.sky-turn').count(), held: await held() },
          expected: { turns: 6, held: 6 },
        })

        await composer.fill('A thought already in the box.')
        await menus.nth(1).click()
        await page.getByRole('menuitem', { name: 'Delete from here…', exact: true }).click()
        await note.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByText('— deleted from here · your question is back in the box —', { exact: true }).waitFor()
        assert({
          given: 'the delete confirmed with words already typed',
          should: 'keep the first exchange alone, on the page and on the service, and add the question to the box',
          actual: {
            turns: await page.locator('.sky-turn').count(),
            held: await held(),
            box: await composer.inputValue(),
            focused: await composer.evaluate((element) => element === document.activeElement),
          },
          expected: {
            turns: 2,
            held: 2,
            box: 'A thought already in the box.\n\nDraft the Atlas announcement.',
            focused: true,
          },
        })

        await ask('Draft the Atlas announcement, shorter.', 'Answer 2.')
        assert({
          given: 'the next message after a delete',
          should: 'continue from the kept exchange, and the quiet line leaves',
          actual: {
            held: await held(),
            line: await page.getByText('— deleted from here', { exact: false }).count(),
          },
          expected: { held: 4, line: 0 },
        })

        // A branch made from the second reply is open: the turns it was made from cannot go.
        const points = ((await (await page.request.get(`${origin}/chat/atlas`)).json()) as any).branchPoints
        const branch = (
          (await (await page.request.post(`${origin}/chat/atlas/branch`, { data: points[3] })).json()) as { id: string }
        ).id
        await page.reload()
        await page.getByText('a branch left here', { exact: false }).waitFor()
        await menus.nth(1).click()
        await page.getByRole('menuitem', { name: 'Delete from here…', exact: true }).click()
        const refusal = page.getByRole('alert').filter({ hasText: 'Can’t delete from here yet.' })
        await refusal.waitFor()
        assert({
          given: 'a delete before a reply an open branch was made from',
          should: 'refuse under the question, link the branch, and offer no Delete',
          actual: {
            link: await refusal.getByRole('link').getAttribute('href'),
            tail: await refusal.locator('.sky-unwind-line').last().innerText(),
            deleteOffered: await refusal.getByRole('button', { name: 'Delete', exact: true }).count(),
            faint: await page.locator('.sky-turn[data-going]').count(),
          },
          expected: {
            link: `/thread/${branch}`,
            tail: 'Discard it first, or delete from a later question.',
            deleteOffered: 0,
            faint: 0,
          },
        })
        await refusal.getByRole('button', { name: 'OK', exact: true }).click()
        await page.request.post(`${origin}/chat/${branch}/end`, { data: { save: false } })
        await page.reload()
        await page.getByText('Answer 1.', { exact: true }).waitFor()

        await menus.first().click()
        await page.getByRole('menuitem', { name: 'Delete from here…', exact: true }).click()
        await note.getByRole('button', { name: 'Delete', exact: true }).click()
        // An emptied chat shows no transcript to carry the quiet line: the question in the box says it.
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Message sky…"]')?.value ===
            'Plan the Atlas launch.',
        )
        assert({
          given: 'a delete from the first question',
          should: 'leave an empty chat with the question in the box, and no thread on the service',
          actual: {
            turns: await page.locator('.sky-turn').count(),
            box: await composer.inputValue(),
            thread: (await page.request.get(`${origin}/chat/atlas`)).status(),
            errors: errors.filter((error) => !error.includes('409')),
          },
          expected: { turns: 0, box: 'Plan the Atlas launch.', thread: 404, errors: [] },
        })
      },
    )
  },
)

test(
  {
    name: 'delete from here leaves saved turns alone and names what Sky already did',
    timeout: 30000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      { initialMarkdown: '# Test notebook\n', tempPrefix: 'sky-unwind-saved-ui-', day: true },
      async ({ page, origin }) => {
        const requests: unknown[] = []
        await page.route('**/chat', (route) => route.fulfill({ json: { threads: [] } }))
        await page.route('**/chat/**', async (route) => {
          const pathname = new URL(route.request().url()).pathname
          if (pathname.endsWith('/settings')) {
            return route.fulfill({
              json: {
                model: {
                  current: 'test',
                  default: 'test',
                  choices: [{ name: 'test', label: 'Test model', provider: 'Test', roles: ['Thinking'] }],
                },
                contextTokens: 0,
                saves: true,
                kept: 0,
                documents: 0,
              },
            })
          }
          if (pathname.endsWith('/unwind')) {
            requests.push(route.request().postDataJSON())
            return route.fulfill({
              status: 409,
              json: { message: 'Those turns are already saved to your notebook. Delete from a later question.' },
            })
          }
          if (pathname.endsWith('/replies')) return route.fulfill({ json: { threads: [] } })
          return route.fulfill({
            json: {
              turns: [
                { role: 'user', content: 'Plan the Atlas launch.' },
                { role: 'assistant', content: 'Start with the demo.' },
                { role: 'user', content: 'Post the Atlas announcement.' },
                { role: 'assistant', content: 'Posted to the launch channel.' },
              ],
              branchPoints: [null, { turn: 1, key: 'reply-1' }, null, { turn: 2, key: 'reply-2' }],
              // The first exchange is in the notebook file already.
              fixed: 2,
              saved: 'mock/atlas.md',
              answered: [
                { id: 'go-1', toolName: 'slack_post', lines: ['Post to #atlas-launch'], approved: true, at: 3 },
              ],
              documents: 0,
              kept: 0,
              busy: false,
              inherited: 0,
              parent: null,
              interrupted: null,
            },
          })
        })
        await page.goto(`${origin}/thread/atlas`)
        await page.getByText('Posted to the launch channel.', { exact: true }).waitFor()
        const menus = page.getByRole('button', { name: 'Message options', exact: true })
        const offered = await menus.count()
        await menus.first().click()
        await page.getByRole('menuitem', { name: 'Delete from here…', exact: true }).click()
        const note = page.getByRole('group', { name: 'Delete from here', exact: true })
        await note.waitFor()
        const done = await note.locator('.sky-unwind-line[data-tone="done"]').allInnerTexts()
        await note.getByRole('button', { name: 'Delete', exact: true }).click()
        const refusal = page.getByRole('alert').filter({ hasText: 'Can’t delete from here yet.' })
        await refusal.waitFor()
        assert({
          given: 'a chat whose first exchange is saved and whose second posted a message',
          should: 'offer the delete on the unsaved question only, name the post, and show a refusal in its words',
          actual: {
            offered,
            done,
            requests,
            refusal: await refusal.locator('.sky-unwind-line').innerText(),
            turns: await page.locator('.sky-turn').count(),
          },
          expected: {
            offered: 1,
            done: ['Already done, and it stays done: Post to #atlas-launch'],
            requests: [{ turn: 1, key: 'reply-1' }],
            refusal: 'Those turns are already saved to your notebook. Delete from a later question.',
            turns: 4,
          },
        })
      },
    )
  },
)
