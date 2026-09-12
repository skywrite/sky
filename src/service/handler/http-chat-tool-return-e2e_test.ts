import type { ChatSessionEvent } from '#shared/models/Chat/ChatSession/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ToolOutputEvent } from './chat/mod.ts'
import { replyThreadTestHost } from './chat/replyThreadsTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test({ name: 'Chat shows the wait between a completed tool and the main reply', timeout: 60000 }, async (t) => {
  const startTool = Promise.withResolvers<void>()
  const finishTool = Promise.withResolvers<void>()
  const startReply = Promise.withResolvers<void>()
  const finishTurn = Promise.withResolvers<void>()
  const opening = 'I will review the sample workbook.'
  const answer = 'The Atlas budget has three categories, with no missing totals.'
  const content = `${opening}\n\n${answer}`
  const toolName = 'google_agent'
  const toolCallId = 'sample-workbook'
  let report: (event: ChatSessionEvent | ToolOutputEvent) => void

  await runWysiwygE2e(
    t,
    {
      initialMarkdown: '# Sample notebook\n',
      tempPrefix: 'sky-tool-return-',
      chat: (root) => {
        const host = replyThreadTestHost(root, {
          invokeModel: async ({ sink }) => {
            sink.write(opening)
            await startTool.promise
            report({
              type: 'tool-execution-start',
              toolName,
              toolCallId,
              phase: 'running',
              started: new ZonedDateTime().epochMilliseconds,
            })
            await finishTool.promise
            report({
              type: 'tool-execution-end',
              toolName,
              toolCallId,
              output: { success: true, report: answer },
              finished: new ZonedDateTime().epochMilliseconds,
            })
            await startReply.promise
            sink.write(`\n\n${answer}`)
            report({ type: 'tool-summary', tool: toolName, text: 'Read the sample workbook' })
            await finishTurn.promise
            return { text: content, content: [], steps: [], responseMessages: [{ role: 'assistant', content }] }
          },
        })
        const createSession = host.createSession
        host.createSession = (id, onEvent, ...args) => {
          report = onEvent
          return createSession(id, onEvent, ...args)
        }
        return host
      },
    },
    async ({ page, origin, errors }) => {
      const restored = await page.context().browser()!.newPage()
      try {
        await page.goto(`${origin}/thread/tool-return`)
        await page.getByRole('textbox', { name: 'Message sky…', exact: true }).fill('Review the sample workbook.')
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await page.getByText(opening, { exact: true }).waitFor()
        startTool.resolve()
        await page.getByRole('progressbar', { name: 'google agent progress' }).waitFor()
        assert({
          given: 'the specialist is running after the main model wrote an opening sentence',
          should: 'show its own progress without a competing thinking message',
          actual: await page.locator('.sky-chat-progress').count(),
          expected: 0,
        })

        finishTool.resolve()
        const progress = page.locator('.sky-chat-progress')
        await progress.getByText('Sky is thinking through the results', { exact: true }).waitFor({ timeout: 3000 })
        assert({
          given: 'the full report returned but the main model has not answered yet',
          should: 'show one progress message below the latest reply and its tools',
          actual: await progress.evaluate((element) => {
            const lastReply = [...document.querySelectorAll('.sky-turn')].at(-1)!
            return {
              count: document.querySelectorAll('.sky-chat-progress').length,
              belowReply: element.getBoundingClientRect().top >= lastReply.getBoundingClientRect().bottom,
              animated: element
                .querySelector('.sky-chat-pulse')!
                .getAnimations()
                .some((animation) => animation.playState === 'running'),
            }
          }),
          expected: { count: 1, belowReply: true, animated: true },
        })
        await progress.locator('.sky-chat-elapsed').waitFor()
        const screenshot = env.get('SKY_BROWSER_SCREENSHOT')
        if (screenshot) await page.screenshot({ path: screenshot, fullPage: true })

        await restored.goto(`${origin}/thread/tool-return`)
        await restored
          .locator('.sky-chat-progress')
          .getByText('Sky is thinking through the results', { exact: true })
          .waitFor()
        assert({
          given: 'the same busy chat opened while waiting after a tool',
          should: 'keep the wait visible below the completed tool',
          actual: await restored.locator('.sky-chat-progress').evaluate((element) => {
            const tool = document.querySelector('[aria-label="Google Agent details"]')!
            return element.getBoundingClientRect().top >= tool.getBoundingClientRect().bottom
          }),
          expected: true,
        })

        startReply.resolve()
        await page.getByText(answer, { exact: true }).waitFor()
        assert({
          given: 'the main answer starts streaming and a tool summary arrives late',
          should: 'remove the thinking message while keeping the answer',
          actual: await progress.count(),
          expected: 0,
        })
        finishTurn.resolve()
        await page.getByRole('textbox', { name: 'Message sky…', exact: true }).waitFor({ state: 'visible' })
        await page.waitForFunction(
          () => !document.querySelector<HTMLTextAreaElement>('.sky-composer textarea')?.disabled,
        )
        await restored.getByText(answer, { exact: true }).waitFor()
        assert({
          given: 'the turn finishes on the stream and the other page refreshes',
          should: 'show the complete reply with no lingering progress or browser errors',
          actual: [await progress.count(), await restored.locator('.sky-chat-progress').count(), errors],
          expected: [0, 0, []],
        })
      } finally {
        startTool.resolve()
        finishTool.resolve()
        startReply.resolve()
        finishTurn.resolve()
        await restored.close()
      }
    },
  )
})
