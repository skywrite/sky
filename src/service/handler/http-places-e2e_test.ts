import { readFile, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

test(
  { name: 'places link by canonical reference on desktop and phone and survive a reload', timeout: 30000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '---\nrel: []\nlocation: places/FR\n---\n\n# Notes\n',
        tempPrefix: 'places-e2e-',
        store: true,
        files: {
          'places/locations/FR.md':
            '---\nname: France\nalt: French Republic\nkind: country\nref: places/FR\n---\n\n# France\n',
          'places/locations/FR/Harbor-City/drink/Cafe.md': '---\nname: Cafe\n---\n',
          'places/locations/US/CA/Foam-City/drink/Cafe.md': '---\nname: Cafe\n---\n',
        },
      },
      async ({ page, origin, relativePath, file, errors }) => {
        await page.goto(`${origin}/explorer/${relativePath}`)
        await page.locator('[data-key="location"] a').filter({ hasText: 'France' }).waitFor()
        await page.getByRole('button', { name: 'Edit', exact: true }).click()
        for (const width of [1500, 430]) {
          await page.setViewportSize({ width, height: 1000 })
          if (width === 430) await page.getByRole('button', { name: 'Show details', exact: true }).click()
          await page.getByRole('button', { name: '+ Add link', exact: true }).click()
          await page.getByLabel('Search notebook links').fill('Cafe')
          await page.getByRole('heading', { name: 'Search results', exact: true }).waitFor()
          assert({
            given: `two cafes at ${width}px`,
            should: 'show both choices with different geographic context',
            actual: [
              await page.getByRole('button', { name: 'Link Cafe', exact: true }).count(),
              (await page.locator('.sky-link-meta').allTextContents()).some((text) => text.includes('Harbor-City')),
              (await page.locator('.sky-link-meta').allTextContents()).some((text) => text.includes('Foam-City')),
            ],
            expected: [2, true, true],
          })
          await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        }
        await page.getByRole('button', { name: '+ Add link', exact: true }).click()
        await page.getByLabel('Search notebook links').fill('French Republic')
        await page.getByRole('button', { name: 'Link France', exact: true }).waitFor()
        const saved = page.waitForResponse(
          (r) => r.url().includes('/docs/_api/content/') && r.request().method() === 'PUT',
        )
        await page.getByRole('button', { name: 'Link France', exact: true }).click()
        await saved
        assert({
          given: 'a country selected by its alias',
          should: 'persist the canonical reference',
          actual: (await readFile(file, 'utf8')).includes('  - places/FR'),
          expected: true,
        })
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.reload()
        const country = page.locator('[data-section="links"] a').filter({ hasText: 'France' })
        await country.waitFor()
        assert({
          given: 'the saved note reopened',
          should: 'show a readable link to the country file without browser errors',
          actual: [await country.getAttribute('href'), errors],
          expected: ['/explorer/places/locations/FR.md', []],
        })
      },
    )
  },
)

test({ name: 'selecting an unsaved country creates and links it on desktop and phone', timeout: 30000 }, async (t) => {
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: '---\nrel: []\n---\n\n# Travel notes\n',
      tempPrefix: 'country-selection-e2e-',
      store: true,
      files: { 'places/readme.md': '# Places\n' },
    },
    async ({ page, origin, relativePath, file, errors }) => {
      const places = path.join(path.dirname(path.dirname(file)), 'places')
      for (const [width, name, code] of [
        [1500, 'France', 'FR'],
        [430, 'Canada', 'CA'],
      ] as const) {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(`${origin}/explorer/${relativePath}`)
        await page.getByRole('button', { name: 'Edit', exact: true }).click()
        if (width === 430) await page.getByRole('button', { name: 'Show details', exact: true }).click()
        await page.getByRole('button', { name: '+ Add link', exact: true }).click()
        await page.getByLabel('Search notebook links').fill(name)
        await page.getByRole('button', { name: `Link ${name}`, exact: true }).waitFor()
        const filesBefore = await readdir(places, { recursive: true })
        assert({
          given: `${name} found in the picker at ${width}px`,
          should: 'remain unsaved while searching and offer no broken preview',
          actual: [
            filesBefore.includes(`locations/${code}.md`),
            await page.getByRole('button', { name: `Preview ${name}`, exact: true }).count(),
          ],
          expected: [false, 0],
        })
        const saved = page.waitForResponse(
          (response) => response.url().includes('/docs/_api/content/') && response.request().method() === 'PUT',
        )
        await page.getByRole('button', { name: `Link ${name}`, exact: true }).click()
        await saved
        await page.setViewportSize({ width: 1500, height: 1000 })
        await page.reload()
        const link = page.locator('[data-section="links"] a').filter({ hasText: name })
        await link.waitFor()
        assert({
          given: `${name} selected and the note reopened`,
          should: 'have a readable link to the newly created country record',
          actual: [
            (await readFile(file, 'utf8')).includes(`  - places/${code}`),
            (await readFile(path.join(places, 'locations', `${code}.md`), 'utf8')).includes(`ref: places/${code}`),
            await link.getAttribute('href'),
            errors,
          ],
          expected: [true, true, `/explorer/places/locations/${code}.md`, []],
        })
      }
    },
  )
})
