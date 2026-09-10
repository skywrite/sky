import { agreementPdf } from '#lib/legalReview/testHelpers.ts'
import { assert, test } from '#test'
import { legalReviewTestHost } from './chat/legalReviewTestHelpers.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  { name: 'agreement summary exposes sources and decisions while drafting stays in a reply thread', timeout: 60000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '# Mock legal review notebook\n',
        tempPrefix: 'sky-legal-ui-',
        day: true,
        chat: (base) => legalReviewTestHost(base),
      },
      async ({ page, origin, errors }) => {
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/thread/review`)
        const main = page.locator('.sky-split-main')
        const composer = main.getByRole('textbox', { name: 'Message sky…', exact: true })
        await composer.fill('Review these five related agreements for Atlas. Flag only material issues here.')
        await main.locator('input[type="file"]').setInputFiles(
          Array.from({ length: 5 }, (_, index) => ({
            name: `agreement-${index + 1}.${index === 1 ? 'pdf' : 'md'}`,
            mimeType: index === 1 ? 'application/pdf' : 'text/markdown',
            buffer: Buffer.from(
              index === 1
                ? agreementPdf('Cancellation requires 30 days notice.')
                : `# Agreement ${index + 1}\n\nCancellation requires 90 days notice.`,
            ),
          })),
        )
        await main.getByRole('button', { name: 'Send', exact: true }).click()
        const summary = main.locator('.sky-legal-review')
        await summary.getByText('5 of 5 agreements · 5 reviewed · 1 issue to discuss', { exact: true }).waitFor()
        await summary.locator(':scope > summary').click()
        await summary.getByText('Document map', { exact: true }).waitFor()
        const finding = summary.locator('.sky-legal-finding')
        await finding.locator('summary').click()
        await finding.getByText('Cancellation requires 90 days notice.', { exact: true }).waitFor()
        // Selection spans a quote while the summary refreshes in the background.
        const quote = finding.locator('blockquote').first()
        await quote.evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const selection = window.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
        })
        await page.waitForTimeout(3400)
        assert({
          given: 'a selected source quote during background refresh',
          should: 'preserve the selected text',
          actual: await page.evaluate(() => window.getSelection()?.toString()),
          expected: 'Cancellation requires 90 days notice.',
        })
        await finding.getByRole('button', { name: 'Ask the team', exact: true }).click()
        await finding.getByText('You chose to ask the team.', { exact: true }).waitFor()
        await page.screenshot({ path: '/tmp/sky-legal-review-desktop.png', fullPage: true })
        await page.reload()
        await summary.locator(':scope > summary').click()
        await finding.locator('summary').click()
        await finding.getByText('You chose to ask the team.', { exact: true }).waitFor()
        await summary.locator(':scope > summary').click()
        await main.getByRole('button', { name: 'Reply in thread', exact: true }).click()
        const panel = page.getByRole('complementary', { name: 'Thread', exact: true })
        await panel
          .getByRole('textbox', { name: 'Reply in thread…', exact: true })
          .fill('Draft a response in my voice.')
        await panel.getByRole('button', { name: 'Send', exact: true }).click()
        await panel
          .getByText('Dear team, please align the cancellation terms across the five agreements.', { exact: true })
          .waitFor()
        assert({
          given: 'drafting from the shared review',
          should: 'keep the response in its reply thread',
          actual: await main
            .getByText('Dear team, please align the cancellation terms across the five agreements.', { exact: true })
            .count(),
          expected: 0,
        })
        await panel.getByRole('button', { name: 'Close thread', exact: true }).click()
        await page.setViewportSize({ width: 430, height: 932 })
        await page.waitForTimeout(250)
        await summary.locator(':scope > summary').click()
        await page.screenshot({ path: '/tmp/sky-legal-review-mobile.png', fullPage: true })
        assert({
          given: 'the review on a narrow display',
          should: 'fit the viewport and produce no client errors',
          actual: {
            overflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
            errors,
          },
          expected: { overflow: false, errors: [] },
        })
      },
    )
  },
)
