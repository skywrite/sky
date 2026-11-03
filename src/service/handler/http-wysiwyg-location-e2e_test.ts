// A person's or organization's location in the explorer is one saved place: chosen, found on
// Google Maps, or offered for text from before places — never typed text.

import { mkdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { openEditor, readMarkdownFromDisk, runWysiwygE2e, waitForSettle } from './httpWysiwygE2eTestHelpers.ts'
import { blankPlace, type MapsHost } from './places/types.ts'

const SAM = '---\nname: Sam Rivera\nlocation: Burlington, VT, USA\n---\n\n# Sam Rivera\n\n## Background\n'
const ALEX = '---\nname: Alex Kim\nmet: 2021\n---\n\n# Alex Kim\n\n## Background\n'
const PLACES = {
  'places/locations/US/VT.md':
    '---\nname: Vermont\nkind: region\nref: places/US/VT\nlocation:\n  country: US\n  region: VT\n---\n',
  'places/locations/US/VT/Burlington.md':
    '---\nname: Burlington\nkind: city\nref: places/US/VT/Burlington\nparent: places/US/VT\n---\n',
}
const maps: MapsHost = {
  config: async () => ({ browserKey: '', mapId: '', searchAvailable: true, configurable: true }),
  configure: async () => {
    throw new Error('Unused in this test.')
  },
  search: async () => [
    {
      id: 'sample_city',
      name: 'Winooski',
      address: 'Winooski, VT, USA',
      kind: 'city',
      category: 'visit',
      coordinates: null,
      attributions: [],
    },
  ],
  detail: async () => blankPlace(),
  locate: async (id) => ({
    kind: 'city',
    name: 'Winooski',
    country: 'US',
    region: { code: 'VT', name: 'Vermont' },
    coordinates: { latitude: 44.49, longitude: -73.19 },
    googlePlaceId: id,
    googleMapsUrl: '',
  }),
}

test(
  {
    name: 'explorer — a profile’s location is a saved place, chosen or found on Google Maps, never typed text',
    timeout: 60000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: SAM,
        tempPrefix: 'wysiwyg-location-',
        file: 'people/2020/sa/Sam-Rivera.md',
        files: { ...PLACES, 'people/2021/al/Alex-Kim.md': ALEX },
        store: true,
        places: { maps },
      },
      async ({ page, origin, file, errors }) => {
        await page.setViewportSize({ width: 1400, height: 900 })
        await openEditor(page, origin, 'people/2020/sa/Sam-Rivera.md')
        await page.waitForSelector('.sky-identity:not([data-readonly])')
        const row = page.locator('.sky-identity .sky-prop[data-key="location"]')
        const input = row.getByRole('textbox', { name: 'Location', exact: true })
        const saveLocation = async (ref: string, choose: () => Promise<void>) => {
          const saved = page.waitForResponse(
            (response) =>
              response.url().includes('/docs/_api/content/') &&
              response.request().method() === 'PUT' &&
              response.request().postData()?.includes(`location: ${ref}`) === true,
          )
          await choose()
          assert({
            given: 'a location chosen for the profile',
            should: 'finish saving its reference before the file is read',
            actual: (await saved).status(),
            expected: 200,
          })
        }
        await row.getByText('Not linked to a saved place yet.', { exact: true }).waitFor()
        const shown = await input.inputValue()
        const capture = async (name: string) => {
          const dir = env.get('SKY_PEOPLE_SCREENSHOTS')
          if (!dir) return
          await mkdir(dir, { recursive: true })
          await page.waitForTimeout(250)
          await page.screenshot({ path: path.join(dir, `explorer-location-${name}.png`) })
        }
        await capture('01-old-text')

        // Typed text with no place chosen is never written
        await input.click()
        await page.keyboard.type('Nowhere at all')
        await page.keyboard.press('Enter')
        const typed = await input.inputValue()
        await page.keyboard.press('Escape')
        await page.locator('.sky-wysiwyg h1').click()
        await waitForSettle(page)
        const afterTyping = await readMarkdownFromDisk(file)

        await saveLocation('places/US/VT/Burlington', () =>
          row.getByRole('button', { name: 'Use Burlington, VT, USA', exact: true }).click(),
        )
        const chosen = await readMarkdownFromDisk(file)

        await input.click()
        await page.keyboard.type('Winoo')
        await page.getByRole('option', { name: 'Find “Winoo” on Google Maps' }).click()
        await page.getByRole('option', { name: /Winooski, VT, USA/ }).waitFor()
        await capture('02-google')
        await saveLocation('places/US/VT/Winooski', () =>
          page.getByRole('option', { name: /Winooski, VT, USA/ }).click(),
        )
        const found = await readMarkdownFromDisk(file)
        const city = await readFile(
          path.join(path.dirname(file), '../../../places/locations/US/VT/Winooski.md'),
          'utf8',
        )

        // A location added to a profile that had none is written as one value, not a list
        const alex = path.join(path.dirname(file), '../../2021/al/Alex-Kim.md')
        await openEditor(page, origin, 'people/2021/al/Alex-Kim.md')
        await page.waitForSelector('.sky-rail:not([data-readonly])')
        await page.click('.sky-rail .sky-props-add input')
        await page.keyboard.type('location')
        await page.keyboard.press('Enter')
        await page.waitForSelector('.sky-identity .sky-prop[data-key="location"] input')
        await page.keyboard.type('Burl')
        await saveLocation('places/US/VT/Burlington', () =>
          page.getByRole('option', { name: /Burlington, VT, USA/ }).click(),
        )

        assert({
          given: 'old text, typed text, the saved place it names, a city found on Google Maps, and a new location',
          should: 'show the text, keep it until a place is chosen, and write each place as one saved reference',
          actual: {
            shown,
            typed,
            afterTyping,
            chosen,
            found,
            city: city.includes('parent: places/US/VT'),
            alex: await readMarkdownFromDisk(alex),
            errors,
          },
          expected: {
            shown: 'Burlington, VT, USA',
            typed: 'Nowhere at all',
            afterTyping: SAM,
            chosen: SAM.replace('location: Burlington, VT, USA', 'location: places/US/VT/Burlington'),
            found: SAM.replace('location: Burlington, VT, USA', 'location: places/US/VT/Winooski'),
            city: true,
            alex: ALEX.replace('met: 2021\n', 'met: 2021\nlocation: places/US/VT/Burlington\n'),
            errors: [],
          },
        })
      },
    )
  },
)
