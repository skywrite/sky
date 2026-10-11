import { assert, test } from '#test'
import { type ReplyTestCall, replyThreadTestHost } from './chat/replyThreadsTestHelpers.ts'
import { composerText, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  {
    name: 'the composer shows Markdown as it will read; Enter sends it, Shift+Enter starts the next block',
    timeout: 60000,
  },
  async (t) => {
    const calls: ReplyTestCall[] = []
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock composer notebook\n',
        tempPrefix: 'sky-chat-composer-',
        chat: (base) => replyThreadTestHost(base, { calls }),
      },
      async ({ page, origin, errors }) => {
        await page.goto(`${origin}/thread/composer`)
        const input = page.getByRole('textbox', { name: 'Message sky…', exact: true })
        await input.click()
        await page.keyboard.type('Review the **Atlas** plan:')
        await page.keyboard.press('Shift+Enter')
        await page.keyboard.type('- pricing')
        await page.keyboard.press('Shift+Enter')
        await page.keyboard.type('notice terms')
        assert({
          given: 'Markdown typed into the composer, Shift+Enter between the lines',
          should: 'show it as it will read: the bold word bold, and the lines after it a list',
          actual: {
            bold: await input.locator('strong').allTextContents(),
            items: await input.locator('li').allTextContents(),
            sent: calls.length,
          },
          expected: { bold: ['Atlas'], items: ['pricing', 'notice terms'], sent: 0 },
        })
        await page.keyboard.press('Enter')
        await page.getByText('All five agreements have been reviewed together.', { exact: true }).waitFor()
        const question = calls[0]?.messages.findLast((message) => message.role === 'user')
        assert({
          given: 'Enter',
          should: 'send the Markdown as written and leave the composer empty',
          actual: {
            // The session heads every message with its time; what follows is what was written.
            sent: String(question?.content ?? '').replace(/^\[Time: [^\]]*\]\n/, ''),
            left: await composerText(input),
            errors,
          },
          expected: { sent: 'Review the **Atlas** plan:\n\n- pricing\n- notice terms', left: '', errors: [] },
        })
      },
    )
  },
)
