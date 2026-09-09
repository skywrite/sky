import * as path from 'node:path'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { modShortcut, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = '2026-01-28'
const PERSON = 'people/Jane-Doe.md'
const PLACE = 'places/Atlas-office.md'

test(
  {
    name: 'global search preserves the page rail, opens records, previews results, and works on phones',
    timeout: 60000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        tempPrefix: 'sky-global-search-e2e-',
        file: `time/2026/W05/01-28/day.md`,
        initialMarkdown: `---\ndate: ${DAY}\n---\n\n# ${DAY}\n\n## Most important\n\n- [ ] Review Atlas\n`,
        store: true,
        day: true,
        files: {
          [PERSON]:
            '---\nname: [Jane Doe, Jay]\norg: Atlas Studio\nrole: Design lead\nemail: jane@example.com\n---\n\nJane leads design at Atlas Studio.\n\nThe next conversation will cover the launch plan.\n',
          [PLACE]: '---\nname: Atlas office\naliases: [Studio room]\n---\n\nThe studio has a quiet meeting room.\n',
          'orgs/Atlas.md': '---\nname: Atlas Studio\n---\n\nAn independent design studio.\n',
          'projects/open/Atlas/_project/overview.md': '---\nname: Atlas\n---\n\nThe website launch.\n',
          'time/2026/W05/01-28/actions/meetings/10-00_Atlas.md': `---\nsummary: Atlas kickoff\nwho: [Jane Doe]\nrel: [projects/Atlas]\n---\n\nThe Atlas kickoff notes.\n`,
          'time/2026/W05/01-28/notes.md': '---\ntitle: Atlas brief\n---\n\nThe launch needs a clearer introduction.\n',
          'library/Guide.md': '---\ntitle: Atlas guide\n---\n\nA guide to the launch.\n',
        },
      },
      async ({ page, origin, errors }) => {
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.goto(`${origin}/${DAY}`)
        await page.locator('.sky-day .sky-day-file').waitFor()
        if (!(await page.locator('.sky-day .sky-rail').isVisible()))
          await page.getByRole('button', { name: 'Show details', exact: true }).click()
        await page.locator('.sky-day .sky-rail').evaluate((element) => {
          element.setAttribute('data-search-preserved', 'yes')
        })
        const railBox = await page.locator('.sky-day .sky-rail').boundingBox()
        const headerBox = await page.locator('.sky-global-header').boundingBox()
        assert({
          given: 'a page with its details rail open',
          should: 'place the global search bar above both columns',
          actual: !!railBox && !!headerBox && railBox.y >= headerBox.y + headerBox.height - 1,
          expected: true,
        })
        const input = page.getByRole('combobox', { name: 'Search anything' })
        await input.fill('Atlas')
        await page.locator('.sky-search-popover [role="option"]').first().waitFor()
        const screenshots = env.get('SKY_SEARCH_SCREENSHOTS')
        if (screenshots)
          await page.screenshot({ path: path.join(screenshots, 'quick-with-rail.png'), animations: 'disabled' })
        assert({
          given: 'a search across the notebook',
          should: 'include people, organizations, places, and day content',
          actual: await page
            .locator('.sky-search-popover')
            .evaluate((element) =>
              ['Jane Doe', 'Atlas Studio', 'Atlas office', 'Atlas kickoff'].every((text) =>
                element.textContent?.includes(text),
              ),
            ),
          expected: true,
        })
        await input.press('Escape')
        assert({
          given: 'quick search dismissed',
          should: 'retain the original mounted details rail',
          actual: await page.locator('.sky-day .sky-rail').getAttribute('data-search-preserved'),
          expected: 'yes',
        })
        await page.keyboard.press(modShortcut('k'))
        await input.fill('Studio room')
        await page.getByRole('option').filter({ hasText: 'Atlas office' }).waitFor()
        await input.press('Enter')
        await page.waitForURL(`${origin}/explorer/${PLACE}`)
        await page.locator('.sky-doc-body').waitFor()
        await input.fill('Atlas')
        await page.locator('.sky-search-popover [role="option"]').first().waitFor()
        await page.getByRole('button', { name: /^View all \d+ results$/ }).click()
        await page.waitForURL('**/search?*')
        await page
          .locator('.sky-search-list .sky-search-row')
          .filter({ has: page.locator('.sky-search-row-title', { hasText: /^Jane Doe$/ }) })
          .click()
        await page.locator('.sky-search-preview-prose p').filter({ hasText: 'Jane leads design' }).waitFor()
        const searchUrl = page.url()
        await input.fill('no-matches-in-this-notebook')
        await page.locator('.sky-search-popover .sky-search-empty h2').waitFor()
        await input.press('Escape')
        assert({
          given: 'quick search dismissed from a results page',
          should: 'preserve the committed query, results and selected preview',
          actual: [page.url(), await input.inputValue(), await page.locator('.sky-search-preview h2').textContent()],
          expected: [searchUrl, 'Atlas', 'Jane Doe'],
        })
        assert({
          given: 'the full search view',
          should: 'show one preview instead of the previous page rail',
          actual: [await page.locator('.sky-rail').count(), await page.locator('.sky-search-preview').count()],
          expected: [0, 1],
        })
        if (screenshots)
          await page.screenshot({ path: path.join(screenshots, 'results-preview.png'), animations: 'disabled' })
        const selectedText = await page.locator('.sky-search-preview-prose').evaluate((element) => {
          const paragraphs = element.querySelectorAll('p')
          const range = document.createRange()
          range.setStart(paragraphs[0]!.firstChild!, 5)
          range.setEnd(paragraphs[1]!.firstChild!, 20)
          const selection = window.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
          return selection.toString()
        })
        await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')))
        await page.waitForTimeout(1200)
        assert({
          given: 'text selected across preview paragraphs during unrelated renders',
          should: 'keep the selection intact',
          actual: await page.evaluate(() => window.getSelection()?.toString()),
          expected: selectedText,
        })
        await page.locator('.sky-search-preview-foot').getByRole('button', { name: 'Open Jane Doe' }).click()
        await page.waitForURL(`${origin}/explorer/${PERSON}`)
        await page.goBack()
        await page.locator('.sky-search-list .sky-search-row').first().waitFor()
        assert({
          given: 'Back after opening a search result',
          should: 'restore the query',
          actual: await input.inputValue(),
          expected: 'Atlas',
        })
        await page.reload()
        await page.locator('.sky-search-list .sky-search-row').first().waitFor()
        await page.locator('.sky-search-page').getByRole('button', { name: 'Places', exact: true }).click()
        await page.locator('.sky-search-heading p').filter({ hasText: '1 result' }).waitFor()
        assert({
          given: 'a bookmarked results page filtered to places',
          should: 'update the URL and filter on the server',
          actual: [
            new URL(page.url()).searchParams.get('kind'),
            await page.locator('.sky-search-list .sky-search-row').count(),
          ],
          expected: ['place', 1],
        })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.locator('.sky-search-list .sky-search-row').first().click()
        await page.locator('.sky-search-preview').waitFor({ state: 'visible' })
        await page.getByRole('button', { name: 'Close preview', exact: true }).click()
        assert({
          given: 'a phone preview closed',
          should: 'return to the results list',
          actual: await page.locator('.sky-search-list').isVisible(),
          expected: true,
        })
        await input.fill(DAY)
        await page.locator('.sky-search-popover').getByRole('button', { name: 'All', exact: true }).click()
        await page
          .getByRole('option')
          .filter({ hasText: `Wednesday · ${DAY}` })
          .waitFor()
        if (screenshots)
          await page.screenshot({ path: path.join(screenshots, 'mobile-day-search.png'), animations: 'disabled' })
        assert({
          given: 'search on a phone',
          should: 'fit the viewport',
          actual: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          expected: true,
        })
        await input.press('Enter')
        await page.waitForURL(`${origin}/${DAY}`)
        await input.fill('no-matches-in-this-notebook')
        await page.getByRole('heading', { name: 'No matches for “no-matches-in-this-notebook”' }).waitFor()
        assert({
          given: 'the completed search flow',
          should: 'produce no browser errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)
