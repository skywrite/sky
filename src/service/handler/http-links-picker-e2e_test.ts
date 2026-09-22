import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY_TITLE = '2026-01-28 - Wed'
const DAY_FILE = 'time/2026/W05/01-28/day.md'
const INITIAL = '---\nrel: [Existing context]\n---\n\n# Notes\n'

for (const width of [1500, 430]) {
  test({ name: `link picker keeps its size and batches selections at ${width}px`, timeout: 45000 }, async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: INITIAL,
        tempPrefix: 'link-picker-e2e-',
        store: true,
        files: {
          [DAY_FILE]: `# **${DAY_TITLE}**\n`,
          'time/2026/W05/01-27/actions/ai-chats/09-00_Atlas.md':
            '---\nsummary: "**Atlas** [review](https://example.com/review) with `Widget-V2`"\n---\n',
          'people/Jane-Doe.md': '---\nname: [Jane Doe, JD]\nupdated: 2026-01-27\n---\n',
          'people/Bob-Example.md': '---\nname: Bob Example\nupdated: 2026-01-26\n---\n',
          ...Object.fromEntries(
            Array.from({ length: 42 }, (_, i) => {
              const name = `Contact ${String(i).padStart(2, '0')}`
              return [`people/${name.replace(' ', '-')}.md`, `---\nname: ${name}\nupdated: 2025-01-01\n---\n`]
            }),
          ),
        },
      },
      async ({ page, origin, relativePath, file, errors }) => {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(`${origin}/explorer/${relativePath}`)
        await page.getByRole('button', { name: 'Edit', exact: true }).click()
        if (width === 430) await page.getByRole('button', { name: 'Show details', exact: true }).click()
        const open = () => page.getByRole('button', { name: '+ Add link', exact: true }).click()
        const search = page.getByLabel('Search notebook links')
        const choice = (title: string) => page.getByRole('checkbox', { name: `Select ${title}`, exact: true })
        const filter = async (label: string) => {
          await page.getByRole('button', { name: 'All types', exact: true }).click()
          if (label !== 'All types') await page.getByRole('checkbox', { name: `Include ${label}`, exact: true }).check()
        }
        const dialog = page.locator('.sky-link-dialog-content')
        await open()
        await choice(DAY_TITLE).waitFor()
        await dialog.evaluate(async (node) => {
          await Promise.all(node.getAnimations().map((animation) => animation.finished))
        })
        const bounds = await dialog.boundingBox()
        assert({
          given: 'Markdown in a day heading and a chat summary',
          should: 'show readable titles without bold, link or code syntax',
          actual: (await page.locator('.sky-link-title').allTextContents()).slice(0, 2),
          expected: [DAY_TITLE, 'Atlas review with Widget-V2'],
        })
        await choice(DAY_TITLE).check()
        await filter('People')
        await choice('Jane Doe').waitFor()
        await search.focus()
        await search.press('ArrowDown')
        await page.keyboard.press('Enter')
        await choice('Bob Example').check()
        await choice('Bob Example').uncheck()
        await page.getByRole('button', { name: 'More records', exact: true }).click()
        await choice('Contact 41').check()
        await page.getByRole('button', { name: 'Previous', exact: true }).click()
        await choice('Jane Doe').waitFor()
        assert({
          given: 'selections made with keyboard and mouse, across a type filter and two pages',
          should: 'keep the day, person and second-page contact selected without writing yet',
          actual: [
            await choice('Jane Doe').isChecked(),
            await choice('Bob Example').isChecked(),
            await page.getByRole('button', { name: 'Add 3 links', exact: true }).isEnabled(),
            await readFile(file, 'utf8'),
          ],
          expected: [true, false, true, INITIAL],
        })

        let release!: () => void
        const held = new Promise<void>((resolve) => {
          release = resolve
        })
        await page.route('**/docs/_api/links?*', async (route) => {
          if (new URL(route.request().url()).searchParams.get('q') === 'missing-record') await held
          await route.continue()
        })
        try {
          await search.fill('missing-record')
          await page.getByText('Loading records…', { exact: true }).waitFor()
          assert({
            given: 'a search waiting for its results',
            should: 'keep the dialog in the same position and at the same size',
            actual: await dialog.boundingBox(),
            expected: bounds,
          })
        } finally {
          release()
        }
        await page.getByText('No matching records. Try another title, person, or date.', { exact: true }).waitFor()
        assert({
          given: 'a search with no matches',
          should: 'retain the dialog size and all pending choices',
          actual: [await dialog.boundingBox(), await page.getByRole('button', { name: 'Add 3 links' }).isEnabled()],
          expected: [bounds, true],
        })
        await search.fill('jd')
        await choice('Jane Doe').waitFor()
        assert({
          given: 'a single matching alias after an empty search',
          should: 'retain its selection and the dialog size',
          actual: [await choice('Jane Doe').isChecked(), await dialog.boundingBox()],
          expected: [true, bounds],
        })
        await filter('All types')
        await search.fill('')
        await choice(DAY_TITLE).waitFor()
        await page.getByRole('button', { name: `Preview ${DAY_TITLE}`, exact: true }).click()
        await page.getByRole('link', { name: 'Open full record ↗' }).waitFor()
        assert({
          given: 'a preview opened after changing filters',
          should: 'keep the selected day and fit the results inside the dialog',
          actual: [
            await choice(DAY_TITLE).isChecked(),
            await dialog.boundingBox(),
            await dialog.evaluate(
              (node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight,
            ),
          ],
          expected: [true, bounds, true],
        })
        const screenshots = env.get('SKY_LINKS_SCREENSHOTS')
        if (screenshots)
          await page.screenshot({ path: path.join(screenshots, `picker-${width}.png`), animations: 'disabled' })
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await open()
        await choice(DAY_TITLE).waitFor()
        assert({
          given: 'canceling and reopening the picker',
          should: 'discard unsaved selections',
          actual: [
            await page.getByRole('button', { name: 'Add 0 links', exact: true }).isDisabled(),
            await readFile(file, 'utf8'),
          ],
          expected: [true, INITIAL],
        })
        await choice(DAY_TITLE).check()
        await filter('People')
        await choice('Jane Doe').check()
        await choice('Bob Example').check()
        const saved = page.waitForResponse(
          (response) => response.url().includes('/docs/_api/content/') && response.request().method() === 'PUT',
        )
        await page.getByRole('button', { name: 'Add 3 links', exact: true }).click()
        await saved
        await dialog.waitFor({ state: 'hidden' })
        await page.locator('[data-section="links"] a').filter({ hasText: DAY_TITLE }).waitFor()
        const content = await readFile(file, 'utf8')
        assert({
          given: 'three confirmed links, including two people',
          should: 'save every canonical reference together and preserve existing context',
          actual: [
            content.includes('2026-01-28/day'),
            content.includes('Jane Doe'),
            content.includes('Bob Example'),
            content.includes('Existing context'),
            content.includes('Contact 41'),
            content.endsWith('# Notes\n'),
            await page.locator('[data-section="links"] a').filter({ hasText: DAY_TITLE }).textContent(),
          ],
          expected: [true, true, true, true, false, true, DAY_TITLE],
        })
        await open()
        const linked = page.getByRole('checkbox', { name: 'Linked Jane Doe', exact: true })
        await linked.waitFor()
        assert({
          given: 'the picker reopened after the batch was saved',
          should: 'mark existing links as checked and prevent duplicates, without browser errors',
          actual: [await linked.isChecked(), await linked.isDisabled(), errors],
          expected: [true, true, []],
        })
        await page.setViewportSize({ width, height: 600 })
        await dialog.evaluate(async (node) => {
          await Promise.all(node.getAnimations().map((animation) => animation.finished))
        })
        if (screenshots)
          await page.screenshot({ path: path.join(screenshots, `picker-short-${width}.png`), animations: 'disabled' })
        assert({
          given: 'a shorter screen with the picker open',
          should: 'keep its actions visible without scrolling the dialog',
          actual: await page.getByRole('button', { name: 'Add 0 links', exact: true }).evaluate((button) => {
            const bounds = button.getBoundingClientRect()
            return bounds.top >= 0 && bounds.bottom <= window.innerHeight
          }),
          expected: true,
        })
      },
    )
  })
}

for (const width of [1500, 430]) {
  test(
    { name: `link picker combines types and uses slate selection colors at ${width}px`, timeout: 45000 },
    async (t) => {
      await runWysiwygE2e(
        t,
        {
          initialMarkdown: INITIAL,
          tempPrefix: 'link-type-union-e2e-',
          store: true,
          files: {
            'people/Jane-Doe.md': '---\nname: Jane Doe\n---\n',
            'orgs/Example-Studio.md': '---\nname: Example Studio\n---\n',
            'projects/open/Atlas/_project/overview.md': '---\nname: Atlas\n---\n',
            [DAY_FILE]: '---\nrel: [Jane Doe, projects/Atlas, Example Studio]\n---\n\n# Planning\n',
            'time/2026/W05/01-27/actions/messages/Email_Atlas.md': '---\nsummary: Atlas follow-up\n---\n',
            'time/2026/W05/01-27/actions/meetings/Atlas.md': '---\nsummary: Atlas check-in\n---\n',
          },
        },
        async ({ page, origin, relativePath, errors }) => {
          await page.setViewportSize({ width, height: 1000 })
          await page.goto(`${origin}/explorer/${relativePath}`)
          await page.getByRole('button', { name: 'Edit', exact: true }).click()
          if (width === 430) await page.getByRole('button', { name: 'Show details', exact: true }).click()
          await page.getByRole('button', { name: '+ Add link', exact: true }).click()
          const include = (name: string) => page.getByRole('checkbox', { name: `Include ${name}`, exact: true })
          const all = page.getByRole('button', { name: 'All types', exact: true })
          const waitForTitles = async (expected: string[]) => {
            await page.waitForFunction(
              (titles) =>
                JSON.stringify(
                  [...document.querySelectorAll('.sky-link-title')].map((element) => element.textContent).sort(),
                ) === JSON.stringify(titles.sort()),
              expected,
            )
          }
          await page.getByRole('heading', { name: 'Frequently linked', exact: true }).waitFor()
          assert({
            given: 'the picker first opened',
            should: 'start unfiltered',
            actual: await all.getAttribute('aria-pressed'),
            expected: 'true',
          })
          await include('People').check()
          await include('Projects').check()
          await waitForTitles(['Jane Doe', 'Atlas'])
          assert({
            given: 'People and Projects checked together',
            should: 'show the union and describe the combination',
            actual: [
              await include('People').isChecked(),
              await include('Projects').isChecked(),
              await page.getByRole('heading', { name: 'People and Projects', exact: true }).isVisible(),
            ],
            expected: [true, true, true],
          })
          await page.getByRole('checkbox', { name: 'Select Jane Doe', exact: true }).check()
          const screenshots = env.get('SKY_LINKS_SCREENSHOTS')
          for (const scheme of ['light', 'dark']) {
            await page.evaluate((colorScheme) => {
              document.documentElement.setAttribute('data-mantine-color-scheme', colorScheme)
            }, scheme)
            await page.locator('.sky-link-picker').evaluate(async (picker) => {
              await Promise.all(picker.getAnimations({ subtree: true }).map((animation) => animation.finished))
            })
            const checkboxColors = await Promise.all(
              [include('People'), page.getByRole('checkbox', { name: 'Select Jane Doe', exact: true })].map((input) =>
                input.evaluate((node) => getComputedStyle(node).backgroundColor),
              ),
            )
            const buttonColor = await page
              .getByRole('button', { name: 'Add 1 link', exact: true })
              .evaluate((button) => getComputedStyle(button).backgroundColor)
            assert({
              given: `a selected type and record in ${scheme} mode`,
              should: 'use the same slate as Sky’s primary action',
              actual: checkboxColors,
              expected: [buttonColor, buttonColor],
            })
            if (screenshots)
              await page.screenshot({
                path: path.join(screenshots, `combined-${scheme}-${width}.png`),
                animations: 'disabled',
              })
          }
          await include('Projects').uncheck()
          await include('Orgs').check()
          await waitForTitles(['Jane Doe', 'Example Studio'])
          assert({
            given: 'switching from People and Projects to People and Orgs',
            should: 'keep the selected person',
            actual: await page.getByRole('checkbox', { name: 'Select Jane Doe', exact: true }).isChecked(),
            expected: true,
          })
          await all.click()
          await include('People').check()
          await include('People').uncheck()
          await page.getByRole('checkbox', { name: 'Select Atlas check-in', exact: true }).waitFor()
          assert({
            given: 'the last type unchecked',
            should: 'return to All types',
            actual: await all.getAttribute('aria-pressed'),
            expected: 'true',
          })
          if (width === 430) await page.getByRole('button', { name: 'More types ▾', exact: true }).click()
          await include('Messages').check()
          await include('Meetings').check()
          if (width === 430) {
            await page.keyboard.press('Escape')
            await page.locator('.sky-link-filter-popover').waitFor({ state: 'hidden' })
          }
          assert({
            given: 'the secondary type choices combined',
            should: 'include both kinds and keep the dialog open after dismissing the phone filters',
            actual: await page.getByRole('dialog', { name: 'Add links', exact: true }).isVisible(),
            expected: true,
          })
          await waitForTitles(['Atlas follow-up', 'Atlas check-in'])
          await page.getByRole('combobox', { name: 'Link date', exact: true }).click()
          await page.getByRole('option', { name: 'Today', exact: true }).click()
          await page.getByText('No matching records. Try another title, person, or date.', { exact: true }).waitFor()
          await include('People').check()
          await waitForTitles(['Jane Doe', 'Atlas follow-up', 'Atlas check-in'])
          assert({
            given: 'an entity type added to dated records',
            should: 'clear the now-hidden date filter and preserve choices without errors',
            actual: [
              await page.getByRole('combobox', { name: 'Link date', exact: true }).count(),
              await page.getByRole('button', { name: 'Add 1 link', exact: true }).isEnabled(),
              errors,
            ],
            expected: [0, true, []],
          })
        },
      )
    },
  )
}
