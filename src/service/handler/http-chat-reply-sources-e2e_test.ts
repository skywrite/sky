import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { writingDraftTestHost } from './chat/draftsTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test({ name: 'reply threads display the draft belonging to the selected response', timeout: 60000 }, async (t) => {
  const first = 'Hi Jane,\n\nPlease review the Atlas outline.\n\nThanks.'
  const second = 'Hi Jane,\n\nThe Widget launch is ready for your approval.\n\nThanks.'
  const quote = (text: string) => `> ${text.replaceAll('\n', '\n> ')}`
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: '# Mock drafting notebook\n',
      tempPrefix: 'sky-reply-sources-',
      day: true,
      chat: (base) => {
        const host = writingDraftTestHost(base)
        return {
          ...host,
          snapshots: async () => {
            const drafts = await Promise.all(
              [first, second].map((text) =>
                host.writingDrafts.create(
                  host.writingDrafts.initial({ meaning: text, medium: 'Email' }, text, 'chat:review'),
                ),
              ),
            )
            return [
              {
                id: 'review',
                startTime: new PlainDateTime('2026-02-04 10:00'),
                state: {
                  conversation: [
                    { role: 'user' as const, content: 'Draft the outline review request.' },
                    { role: 'assistant' as const, content: `The outline request.\n\n${quote(first)}` },
                    { role: 'user' as const, content: 'Now draft a separate launch approval request.' },
                    { role: 'assistant' as const, content: `The launch request.\n\n${quote(second)}` },
                    { role: 'user' as const, content: 'Show the outline request again.' },
                    { role: 'assistant' as const, content: `The outline again.\n\n${quote(first)}` },
                  ],
                  universePaths: [],
                  queries: [],
                  contextLog: [],
                  lastTurn: 3,
                  writingDrafts: drafts.map((draft, i) => ({ id: draft.id, turn: i + 1 })),
                },
              },
            ]
          },
        }
      },
    },
    async ({ page, origin, errors }) => {
      await page.setViewportSize({ width: 1600, height: 1050 })
      await page.goto(`${origin}/thread/review`)
      const main = page.locator('.sky-split-main')
      const buttons = main.locator('.sky-reply-acts').getByRole('button', { name: 'Work on this…', exact: true })
      const panel = page.getByRole('complementary', { name: 'Thread', exact: true })
      const composer = panel.getByPlaceholder('Discuss or request changes…')
      const visibleDrafts = panel.locator('.sky-writing-draft-body')
      for (const [index, expected] of [first, second, first, second].entries()) {
        const source = [0, 1, 2, 1][index]!
        await buttons.nth(source).click()
        await composer.waitFor()
        await visibleDrafts.first().waitFor()
        assert({
          given: `opening the reply thread for response ${source + 1}`,
          should: 'show only its own draft, including a draft quoted again from an earlier response',
          actual: await visibleDrafts.allInnerTexts(),
          expected: [expected],
        })
        await panel.getByRole('button', { name: 'Close thread', exact: true }).click()
        await panel.waitFor({ state: 'hidden' })
      }
      assert({
        given: 'multiple empty threads opened and closed',
        should: 'keep each response action available without zero reply counts or browser errors',
        actual: {
          actions: await buttons.count(),
          emptyCounts: await main.getByText('0 replies', { exact: true }).count(),
          errors,
        },
        expected: { actions: 3, emptyCounts: 0, errors: [] },
      })
    },
  )
})
