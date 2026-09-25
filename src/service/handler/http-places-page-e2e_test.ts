import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import { blankPlace, type MapsConfig, type MapsHost } from './places/types.ts'

// Only the third-party map canvas is scripted. Routes, files, forms, markers and refreshes run in the real app.
const mapScript = `
  const events = { clearInstanceListeners() {}, addListenerOnce(map, event, callback) { setTimeout(callback, 0); } };
  class MapView {
    constructor(element, options) {
      this.element = element; this.center = options.center; this.zoom = options.zoom; this.handlers = {};
      element.style.background = 'repeating-linear-gradient(45deg, #e9efe9, #e9efe9 40px, #f8faf8 40px, #f8faf8 43px)';
      element.addEventListener('click', event => { if (event.target === element) this.handlers.click?.({ latLng: this.getCenter() }); });
    }
    addListener(name, callback) { this.handlers[name] = callback; }
    fitBounds(bounds) { this.center = bounds.points[0] || this.center; }
    setCenter(value) { this.center = value; }
    panTo(value) { this.center = value; }
    setZoom(value) { this.zoom = value; }
    getZoom() { return this.zoom; }
    getCenter() { return { lat: () => this.center.lat, lng: () => this.center.lng }; }
    setOptions() {}
  }
  class Marker {
    constructor(options) {
      this.element = document.createElement('button'); this.element.setAttribute('aria-label', options.title);
      this.element.style.cssText = 'position:relative;margin:100px 35px 20px;border:0;background:transparent;';
      if (options.content) this.element.append(options.content); this.map = options.map;
    }
    set map(value) { if (value) value.element.append(this.element); else this.element.remove(); }
    addListener(name, callback) { this.element.addEventListener(name, event => { event.stopPropagation(); callback(event); }); }
  }
  window.google = { maps: { Map: MapView, ColorScheme: { LIGHT: 'LIGHT', DARK: 'DARK' }, event: events,
    LatLngBounds: class { points = []; extend(point) { this.points.push(point); } },
    marker: { AdvancedMarkerElement: Marker }, importLibrary: async () => ({ AdvancedMarkerElement: Marker }) } };
  window.skyPlacesMapsReady();
`

test(
  {
    name: 'Places UI creates, searches, edits, maps, links and archives real records on desktop and phone',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120_000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-places-browser-'))
    const dirs = ['places', 'people', 'orgs', 'library'].map((dir) => path.join(root, dir))
    await Promise.all(dirs.map((dir) => mkdir(dir)))
    const store = await MarkdownStore.build({
      placesDir: dirs[0],
      peopleDirs: [dirs[1]],
      orgDirs: [dirs[2]],
      libraryDir: dirs[3],
    })
    let config: MapsConfig = { browserKey: '', mapId: '', searchAvailable: true, configurable: true }
    const maps: MapsHost = {
      config: async () => config,
      configure: async (input) => (config = { ...config, browserKey: input.browserKey ?? config.browserKey }),
      search: async (query) =>
        query.toLowerCase().includes('garden')
          ? [
              {
                id: 'sample_garden_house',
                name: 'Garden House',
                address: '12 Example Street, Paris',
                kind: 'venue',
                category: 'drink',
                coordinates: { latitude: 48.85837, longitude: 2.294481 },
                attributions: [],
              },
            ]
          : [],
      detail: async (id) => ({
        ...blankPlace(),
        name: 'Garden House',
        address: '12 Example Street, Paris',
        category: 'drink',
        country: 'FR',
        city: 'Paris',
        googlePlaceId: id,
        coordinates: { latitude: 48.85837, longitude: 2.294481 },
      }),
    }
    const app = createTestHttpApp(dirs, {
      markdownStore: store,
      places: {
        placesDir: dirs[0],
        stateDir: path.join(root, '.state'),
        now: () => new ZonedDateTime('2026-02-12 09:34', 'America/Chicago'),
        maps,
      },
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }),
      address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address.')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1600, height: 1040 }, deviceScaleFactor: 1 })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('https://maps.googleapis.com/maps/api/js?*', (route) =>
        route.fulfill({ contentType: 'text/javascript', body: mapScript }),
      )
      const base = `http://127.0.0.1:${address.port}`
      const capture = async (name: string) => {
        const dir = env.get('SKY_PLACES_SCREENSHOTS')
        if (dir) {
          await mkdir(dir, { recursive: true })
          await page.waitForTimeout(200)
          await page.screenshot({ path: path.join(dir, `${name}.png`) })
        }
      }
      await page.goto(`${base}/places`)
      await page.getByRole('heading', { name: 'A place for your places', exact: true }).waitFor()
      await capture('01-empty')
      await page.getByRole('button', { name: 'Add manually', exact: true }).click()
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('France')
      await page.getByRole('combobox', { name: 'Kind of place', exact: true }).click()
      await page.getByRole('option', { name: 'Country', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Add place', exact: true }).click()
      await page.getByRole('heading', { name: 'France', exact: true }).waitFor()
      await page.getByRole('link', { name: '‹ Places', exact: true }).click()
      await page.getByRole('button', { name: 'Add place', exact: true }).click()
      await page.getByRole('button', { name: 'Enter manually', exact: true }).click()
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Paris')
      await page.getByRole('combobox', { name: 'Kind of place', exact: true }).click()
      await page.getByRole('option', { name: 'City', exact: true }).click()
      await page.getByRole('combobox', { name: 'Located in', exact: true }).click()
      await page.getByRole('option', { name: 'France · Country', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Add place', exact: true }).click()
      await page.getByRole('heading', { name: 'Paris', exact: true }).waitFor()
      const cityPath = new URL(page.url()).pathname
      await page.getByRole('link', { name: '‹ Places', exact: true }).click()
      await page.getByRole('button', { name: 'Add place', exact: true }).click()
      await page.getByRole('textbox', { name: 'Find a place on Google Maps', exact: true }).fill('Garden')
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await page.getByRole('button', { name: /Garden House/ }).click()
      const beforeSave = store.places.size
      await page.getByRole('combobox', { name: 'Located in', exact: true }).click()
      await page.getByRole('option', { name: 'Paris · City', exact: true }).click()
      await page
        .getByRole('textbox', { name: 'Notes', exact: true })
        .fill('A first paragraph about this place.\n\nA second paragraph about a future visit.')
      await capture('02-review')
      await page.getByRole('dialog').getByRole('button', { name: 'Add place', exact: true }).click()
      await page.getByRole('heading', { name: 'Garden House', exact: true }).waitFor()
      const placePath = new URL(page.url()).pathname,
        entry = store.places.getEntries().find((p) => p.value.name === 'Garden House')!
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Garden House Café')
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await page.getByRole('heading', { name: 'Garden House Café', exact: true }).waitFor()
      const sameRoute = new URL(page.url()).pathname === placePath
      await page.getByRole('button', { name: 'Add note', exact: true }).click()
      await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Bring the workshop notes.')
      await page.getByRole('button', { name: 'Save note', exact: true }).click()
      await page.getByText('Bring the workshop notes.', { exact: true }).waitFor()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.bringToFront()
      const selection = await page.evaluate(() => {
        const p = document.querySelectorAll('.sky-places-prose p'),
          range = document.createRange()
        range.setStart(p[0].firstChild!, 2)
        range.setEnd(p[1].firstChild!, 8)
        window.getSelection()!.removeAllRanges()
        window.getSelection()!.addRange(range)
        return window.getSelection()!.toString()
      })
      const refresh = page.waitForResponse((response) => response.url().includes('/places/_api/place?'))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await refresh
      await page.waitForTimeout(100)
      const kept = await page.evaluate(() => window.getSelection()?.toString())
      const raw = await readFile(entry.path, 'utf8')
      await writeFile(entry.path, raw + '\nAn external notebook update.\n')
      store.set(entry.path, await readFile(entry.path, 'utf8'))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await page.getByText('An external notebook update.', { exact: true }).waitFor()
      await capture('03-detail')
      await page.goto(`${base}${cityPath}`)
      await page.getByRole('link', { name: 'Open Garden House Café', exact: true }).waitFor()
      await capture('04-city')
      await page.getByRole('link', { name: '‹ Places', exact: true }).click()
      await page.getByRole('button', { name: 'Connect Google Maps', exact: true }).click()
      await page.getByRole('textbox', { name: 'Browser map key', exact: true }).fill('sample-browser-key')
      await page.getByRole('button', { name: 'Save connection', exact: true }).click()
      await page.getByRole('button', { name: 'Select Garden House Café', exact: true }).click()
      await page.getByRole('button', { name: 'View place', exact: true }).waitFor()
      await capture('05-map')
      await page.getByRole('button', { name: 'Close place preview', exact: true }).click()
      await page.getByRole('button', { name: 'Drop a pin', exact: true }).click()
      await page.getByRole('button', { name: 'Use map center', exact: true }).click()
      await page.getByRole('button', { name: 'Add place here', exact: true }).click()
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Cliff Viewpoint')
      await page.getByRole('dialog').getByRole('button', { name: 'Add place', exact: true }).click()
      await page.getByRole('heading', { name: 'Cliff Viewpoint', exact: true }).waitFor()
      const dropped = store.places.getEntries().find((p) => p.value.name === 'Cliff Viewpoint')?.value.location
      await page.getByRole('button', { name: 'Place actions', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Archive place', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Archive place', exact: true }).click()
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await page.getByRole('link', { name: 'Open Cliff Viewpoint', exact: true }).waitFor()
      await page.getByRole('textbox', { name: 'Search your places', exact: true }).fill('missing sample')
      await page.getByRole('heading', { name: 'No places found', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
      await page.getByRole('button', { name: 'List', exact: true }).click()
      await capture('06-list')
      await page.getByRole('button', { name: 'Map', exact: true }).click()
      await page.setViewportSize({ width: 390, height: 844 })
      await capture('07-mobile-map')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      await page.getByRole('link', { name: 'Open Garden House Café', exact: true }).click()
      await capture('08-mobile-detail')
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await capture('09-mobile-editor')
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.reload()
      await page.getByRole('heading', { name: 'Garden House Café', exact: true }).waitFor()
      assert({
        given: 'real UI operations against an isolated notebook and a scripted Google host',
        should:
          'create only on save, preserve identity and selection, save coordinates and render on phones without errors',
        actual: [
          beforeSave,
          sameRoute,
          kept === selection,
          store.places.size,
          dropped?.latitude,
          dropped?.longitude,
          overflow,
          errors,
        ],
        expected: [2, true, true, 4, 48.85837, 2.294481, false, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
)
