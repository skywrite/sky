import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium, type Page } from 'playwright'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { blankPlace, type MapsConfig } from './places/types.ts'

test(
  {
    name: 'People locations: find a city on Google Maps, replace old text, add a city by hand, and link to the place',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120_000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-people-location-'))
    const peopleDir = path.join(root, 'people'),
      orgsDir = path.join(root, 'orgs'),
      placesDir = path.join(root, 'places')
    const write = async (file: string, raw: string) => {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await writeFile(path.join(root, file), raw)
    }
    await mkdir(orgsDir, { recursive: true })
    await write(
      'places/locations/US/VT.md',
      '---\nname: Vermont\nkind: region\nref: places/US/VT\nlocation:\n  country: US\n  region: VT\n---\n',
    )
    await write(
      'places/locations/US/VT/Burlington.md',
      '---\nname: Burlington\nkind: city\nref: places/US/VT/Burlington\nparent: places/US/VT\n---\n',
    )
    // A profile from before places, its location written as text
    await write(
      'people/2020/sa/Sam-Rivera.md',
      '---\nname: Sam Rivera\nlocation: Burlington, VT, USA\n---\n\n# Sam Rivera\n\n## Background\n',
    )
    const store = await MarkdownStore.build({ peopleDirs: [peopleDir], orgDirs: [orgsDir], placesDir })
    const now = () => new ZonedDateTime('2026-02-12 09:34', 'America/Chicago')
    let config: MapsConfig = { browserKey: '', mapId: '', searchAvailable: true, configurable: true }
    const app = createTestHttpApp([peopleDir, orgsDir, placesDir], {
      markdownStore: store,
      people: { peopleDir, orgsDir, stateDir: path.join(root, '.state'), now },
      places: {
        placesDir,
        stateDir: path.join(root, '.state'),
        now,
        maps: {
          config: async () => config,
          configure: async () => config,
          search: async () => [
            {
              id: 'sample_city',
              name: 'Winooski',
              address: 'Winooski, VT, USA',
              kind: 'city',
              category: 'visit',
              coordinates: { latitude: 44.49, longitude: -73.19 },
              attributions: [],
            },
            {
              id: 'sample_shop',
              name: 'Winooski Books',
              address: '1 Main Street, Winooski, VT, USA',
              kind: 'venue',
              category: 'shop',
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
        },
      },
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address.')
    const base = `http://127.0.0.1:${address.port}`
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1280, height: 960 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const capture = async (name: string) => {
        const dir = env.get('SKY_PEOPLE_SCREENSHOTS')
        if (!dir) return
        await mkdir(dir, { recursive: true })
        await page.waitForTimeout(250)
        await page.screenshot({ path: path.join(dir, `location-${name}.png`) })
      }
      const dialog = page.getByRole('dialog')
      const location = dialog.getByLabel('Location', { exact: true })
      const valueOf = (input = location) => input.inputValue()
      const fileOf = async (name: string) => {
        const entry = store.people
          .getAll()
          .toArray()
          .find(({ doc }) => doc.yaml.name === name)
        return entry ? readFile(entry.path, 'utf8') : ''
      }
      const addPerson = async (tab: Page, name: string) => {
        await tab.goto(`${base}/people`)
        await tab
          .getByRole('button', { name: /Add (your first )?person/ })
          .first()
          .click()
        await tab.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
        await tab.getByRole('button', { name: 'More details', exact: true }).click()
      }

      // A city with no record yet, found on Google Maps and saved inside its saved state
      await addPerson(page, 'Riley Voss')
      await location.fill('Winoo')
      await page.getByRole('option', { name: 'Find “Winoo” on Google Maps' }).click()
      const offered = page.getByRole('option', { name: /Winooski/ })
      await offered.first().waitFor()
      const offeredNames = await offered.allTextContents()
      await capture('01-google')
      await offered.first().click()
      await page.waitForFunction(
        (input) => (input as HTMLInputElement).value === 'Winooski, VT, USA',
        await location.elementHandle(),
      )
      await dialog.getByRole('button', { name: 'Add person', exact: true }).click()
      await page.getByRole('heading', { name: 'Riley Voss', exact: true }).waitFor()
      const placeLink = page.getByRole('link', { name: 'Winooski, VT, USA', exact: true })
      const riley = {
        href: await placeLink.getAttribute('href'),
        file: (await fileOf('Riley Voss')).includes('\nlocation: places/US/VT/Winooski\n'),
        city: (await readFile(path.join(placesDir, 'locations/US/VT/Winooski.md'), 'utf8')).includes(
          'parent: places/US/VT',
        ),
      }
      await capture('02-profile')
      await placeLink.click()
      await page.getByRole('heading', { name: 'Winooski', exact: true }).waitFor()
      const placeUrl = new URL(page.url()).pathname

      // Text from before places: the saved place it names is one click away; typed text is never kept
      await page.goto(`${base}/people/people/2020/sa/Sam-Rivera.md`)
      await page.getByRole('heading', { name: 'Sam Rivera', exact: true }).waitFor()
      const oldText = await page.locator('.sky-people-details').getByText('Burlington, VT, USA').count()
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await dialog.getByText('Not linked to a saved place yet.', { exact: true }).waitFor()
      await capture('03-old-text')
      await location.fill('Nowhere at all')
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).click()
      const afterTyping = await valueOf()
      await dialog.getByRole('button', { name: 'Use Burlington, VT, USA', exact: true }).click()
      const chosen = await valueOf()
      await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
      await page.getByRole('link', { name: 'Burlington, VT, USA', exact: true }).waitFor()
      const sam = (await fileOf('Sam Rivera')).includes('\nlocation: places/US/VT/Burlington\n')

      // Without Google Maps, a city is added by hand inside a country that has no record yet
      config = { ...config, searchAvailable: false }
      await addPerson(page, 'Alex Kim')
      await location.fill('Harbor City')
      await page.getByRole('option', { name: 'Add “Harbor City” as a new city…' }).click()
      const where = dialog.getByRole('combobox', { name: 'Where is Harbor City?' })
      await where.fill('Fran')
      await page.getByRole('option', { name: 'France', exact: true }).click()
      await capture('04-by-hand')
      await dialog.getByRole('button', { name: 'Add Harbor City', exact: true }).click()
      await page.waitForFunction(
        (input) => (input as HTMLInputElement).value === 'Harbor City, France',
        await location.elementHandle(),
      )
      await page.setViewportSize({ width: 390, height: 844 })
      await location.fill('Burl')
      await page.getByRole('option', { name: /Burlington, VT, USA/ }).waitFor()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      await capture('05-mobile')
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width: 1280, height: 960 })
      await dialog.getByRole('button', { name: 'Add person', exact: true }).click()
      await page.getByRole('heading', { name: 'Alex Kim', exact: true }).waitFor()
      const alex = (await fileOf('Alex Kim')).includes('\nlocation: places/FR/Harbor-City\n')

      assert({
        given: 'people located through the picker: a city found on Google Maps, old text, and a city added by hand',
        should: 'save each as a place that reads like an address and links to its place page, never as typed text',
        actual: {
          offeredNames,
          riley,
          placeUrl,
          oldText,
          afterTyping,
          chosen,
          sam,
          alex,
          france: (await readFile(path.join(placesDir, 'locations/FR.md'), 'utf8')).includes('name: France'),
          overflow,
          errors,
        },
        expected: {
          offeredNames: ['Winooski, VT, USAAdd city'],
          riley: { href: '/places/US/VT/Winooski', file: true, city: true },
          placeUrl: '/places/US/VT/Winooski',
          oldText: 1,
          afterTyping: 'Burlington, VT, USA',
          chosen: 'Burlington, VT, USA',
          sam: true,
          alex: true,
          france: true,
          overflow: false,
          errors: [],
        },
      })
    } finally {
      await browser?.close()
      server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
