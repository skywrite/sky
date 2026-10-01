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
import { blankPlace, placeCategories, type MapsConfig, type MapsHost } from './places/types.ts'

// Only the third-party map canvas is scripted. Routes, files, forms, markers and refreshes run in the real app.
const mapScript = `
  const events = {
    clearInstanceListeners(instance) { instance.handlers = {}; },
    addListenerOnce(map, event, callback) {
      const listener = map.addListener(event, () => { listener.remove(); callback(); });
      return listener;
    }
  };
  class Bounds {
    constructor(value) { this.value = value; this.points = []; }
    extend(point) { this.points.push(point); return this; }
    contains(point) {
      const b = this.value;
      return point.lat >= b.south && point.lat <= b.north &&
        (b.west <= b.east ? point.lng >= b.west && point.lng <= b.east : point.lng >= b.west || point.lng <= b.east);
    }
  }
  class MapView {
    constructor(element, options) {
      this.element = element; this.center = options.center; this.zoom = options.zoom; this.handlers = {};
      this.markerCount = 0;
      element.style.background = 'repeating-linear-gradient(45deg, #e9efe9, #e9efe9 40px, #f8faf8 40px, #f8faf8 43px)';
      element.addEventListener('click', event => { if (event.target === element) this.emit('click', { latLng: this.getCenter() }); });
      element.addEventListener('sky-test-map-bounds', event => { this.bounds = new Bounds(event.detail); this.idle(); });
      this.fitCount = 0;
    }
    addListener(name, callback) {
      const listeners = this.handlers[name] ||= new Set(); listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    }
    emit(name, value) { for (const callback of this.handlers[name] || []) callback(value); }
    idle() {
      this.element.dataset.viewport = JSON.stringify({ center: this.center, zoom: this.zoom, bounds: this.bounds?.value });
      clearTimeout(this.timer); this.timer = setTimeout(() => this.emit('idle'), 0);
    }
    fitBounds(bounds) {
      this.center = bounds.points[0] || this.center;
      this.bounds = new Bounds({
        south: Math.min(...bounds.points.map(p => p.lat)) - .02,
        north: Math.max(...bounds.points.map(p => p.lat)) + .02,
        west: Math.min(...bounds.points.map(p => p.lng)) - .02,
        east: Math.max(...bounds.points.map(p => p.lng)) + .02
      });
      this.element.dataset.fitCount = String(++this.fitCount); this.idle();
    }
    setCenter(value) { this.center = value; this.bounds = null; this.idle(); }
    panTo(value) { this.setCenter(value); }
    setZoom(value) { this.zoom = value; this.bounds = null; this.idle(); }
    getZoom() { return this.zoom; }
    getBounds() {
      const span = 360 / 2 ** this.zoom;
      return this.bounds || new Bounds({ south: this.center.lat - span, north: this.center.lat + span,
        west: this.center.lng - span, east: this.center.lng + span });
    }
    getCenter() { return { lat: () => this.center.lat, lng: () => this.center.lng }; }
    setOptions() {}
  }
  class Marker {
    constructor(options) {
      this.element = document.createElement('button'); this.element.setAttribute('aria-label', options.title);
      const i = options.map.markerCount++;
      this.element.style.cssText = 'position:absolute;left:' + (12 + i % 5 * 17) + '%;top:' + (48 + Math.floor(i / 5) * 17) + '%;border:0;background:transparent;';
      if (options.content) this.element.append(options.content); this.map = options.map;
    }
    set map(value) { if (value) value.element.append(this.element); else this.element.remove(); }
    addListener(name, callback) { this.element.addEventListener(name, event => { event.stopPropagation(); callback(event); }); }
  }
  class InfoWindow {
    constructor(options) {
      this.handlers = {}; this.element = document.createElement('div');
      this.element.className = 'gm-style-iw-c'; this.element.setAttribute('role', 'dialog');
      this.element.setAttribute('aria-label', options.ariaLabel); this.element.append(options.content);
      this.element.style.cssText = 'position:absolute;z-index:1001;transform:translate(-50%,-100%);';
    }
    addListener(name, callback) { return MapView.prototype.addListener.call(this, name, callback); }
    open({ map, anchor }) {
      this.element.dataset.anchor = anchor.element.getAttribute('aria-label');
      map.element.append(this.element);
      const position = () => {
        const area = map.element.getBoundingClientRect(), pin = anchor.element.getBoundingClientRect();
        const half = this.element.offsetWidth / 2;
        const x = Math.max(half + 10, Math.min(area.width - half - 10, pin.left - area.left + pin.width / 2));
        const y = Math.max(this.element.offsetHeight + 10, pin.top - area.top - 8);
        anchor.element.style.left = (x - pin.width / 2) + 'px';
        anchor.element.style.top = (y + 8) + 'px';
        this.element.style.left = x + 'px'; this.element.style.top = y + 'px';
      };
      position(); this.listener = map.addListener('idle', position);
    }
    close() { this.listener?.remove(); this.element.remove(); }
  }
  window.google = { maps: { Map: MapView, ColorScheme: { LIGHT: 'LIGHT', DARK: 'DARK' }, event: events,
    LatLngBounds: Bounds, InfoWindow,
    marker: { AdvancedMarkerElement: Marker }, importLibrary: async () => ({ AdvancedMarkerElement: Marker }) } };
  window.skyPlacesMapsReady();
`

test(
  {
    name: 'Places show category icons and keep sidebar results within the map viewport',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120_000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-places-viewport-'))
    const dirs = ['places', 'people', 'orgs', 'library'].map((dir) => path.join(root, dir))
    await Promise.all(dirs.map((dir) => mkdir(dir)))
    const categories = Object.keys(placeCategories)
    const savedGoogleLink = 'https://maps.google.com/?cid=424242'
    const sharedGoogleLink = 'https://maps.app.goo.gl/ExampleAtlasPlace'
    for (const [i, category] of categories.entries()) {
      const file = path.join(dirs[0], 'locations', category === 'drink' ? 'FR/Paris/drink' : '', `Atlas-${category}.md`)
      await mkdir(path.dirname(file), { recursive: true })
      const metadata =
        category === 'drink'
          ? `GoogleMaps: { type: cafe, url: "${savedGoogleLink}" }`
          : category === 'eat'
            ? `GoogleMaps: { type: restaurant }\ngoogleMapsUrl: "${sharedGoogleLink}"`
            : `type: ${category}`
      await writeFile(
        file,
        `---\nname: Atlas ${category}\n${metadata}\nlocation: { latitude: ${48.85837 + i / 100}, longitude: ${2.294481 + i / 100} }\n---\nSample notes.\n`,
      )
    }
    await writeFile(
      path.join(dirs[0], 'locations', 'Atlas-Unmapped.md'),
      '---\nname: Atlas Unmapped\ntype: visit\n---\n',
    )
    const store = await MarkdownStore.build({
      placesDir: dirs[0],
      peopleDirs: [dirs[1]],
      orgDirs: [dirs[2]],
      libraryDir: dirs[3],
    })
    const app = createTestHttpApp(dirs, {
      markdownStore: store,
      places: {
        placesDir: dirs[0],
        stateDir: path.join(root, '.state'),
        maps: {
          config: async () => ({
            browserKey: 'sample-browser-key',
            mapId: '',
            searchAvailable: false,
            configurable: false,
          }),
          configure: async () => {
            throw new Error('Unused in this test.')
          },
          search: async () => [],
          detail: async () => blankPlace(),
        },
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
      const page = await browser.newPage({ viewport: { width: 1600, height: 1040 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('https://maps.googleapis.com/maps/api/js?*', (route) =>
        route.fulfill({ contentType: 'text/javascript', body: mapScript }),
      )
      const capture = async (name: string) => {
        const dir = env.get('SKY_PLACES_SCREENSHOTS')
        if (dir) {
          await mkdir(dir, { recursive: true })
          await page.waitForTimeout(200)
          await page.screenshot({ path: path.join(dir, `${name}.png`) })
        }
      }
      const canvas = page.locator('.sky-places-map-canvas')
      const rowNames = () => page.locator('.sky-places-results .sky-places-row-copy > strong').allTextContents()
      const viewport = async (north: number, south: number, east: number, west: number) => {
        await canvas.evaluate(
          (element, bounds) => element.dispatchEvent(new CustomEvent('sky-test-map-bounds', { detail: bounds })),
          { north, south, east, west },
        )
      }
      await page.goto(`http://127.0.0.1:${address.port}/places`)
      await page.getByText('In this map area', { exact: true }).waitFor()
      await page.getByText(`${categories.length} on map`, { exact: true }).waitFor()
      const rowIcons = await page
        .locator('.sky-places-results .sky-places-avatar svg')
        .evaluateAll((icons) => icons.map((icon) => icon.innerHTML))
      const markerIcons = await page
        .locator('.sky-places-pin svg')
        .evaluateAll((icons) => icons.map((icon) => icon.innerHTML))
      assert({
        given: 'every supported category, including legacy drink and restaurant records',
        should: 'use distinct category icons consistently in rows and map markers',
        actual: [rowIcons.length, new Set(rowIcons).size, markerIcons],
        expected: [categories.length, categories.length, rowIcons],
      })
      await capture('10-category-icons')
      await page.getByRole('button', { name: 'Select Atlas drink', exact: true }).click()
      const preview = page.getByRole('dialog', { name: 'Atlas drink', exact: true })
      await preview.getByRole('button', { name: 'View place', exact: true }).waitFor()
      const apple = new URL(
        (await preview.getByRole('link', { name: 'Apple Maps', exact: true }).getAttribute('href'))!,
      )
      const google = await preview.getByRole('link', { name: 'Google Maps', exact: true }).getAttribute('href')
      assert({
        given: 'a selected place marker',
        should: 'anchor its popup and preserve its saved Google Maps destination',
        actual: [
          await preview.getAttribute('data-anchor'),
          apple.hostname,
          apple.searchParams.get('q'),
          apple.searchParams.get('ll'),
          google,
        ],
        expected: ['Select Atlas drink', 'maps.apple.com', 'Atlas drink', '48.85837,2.294481', savedGoogleLink],
      })
      await capture('13-anchored-popup')
      await page.getByRole('button', { name: 'Select Atlas eat', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Atlas eat', exact: true })
        .getByRole('link', { name: 'Apple Maps', exact: true })
        .waitFor()
      assert({
        given: 'a saved Google Maps share link',
        should: 'use the same link in the popup',
        actual: await page
          .getByRole('dialog', { name: 'Atlas eat', exact: true })
          .getByRole('link', { name: 'Google Maps', exact: true })
          .getAttribute('href'),
        expected: sharedGoogleLink,
      })
      await page.getByRole('button', { name: 'Close place preview', exact: true }).click()
      await page.getByRole('button', { name: 'Show all places on map', exact: true }).click()
      const initialFits = await canvas.getAttribute('data-fit-count')
      await viewport(48.86, 48.85, 2.3, 2.29)
      await page.getByText('1 on map', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Select Atlas drink', exact: true }).click()
      await preview.evaluate((element) => element.setAttribute('data-kept', 'true'))
      const refresh = page.waitForResponse((response) => new URL(response.url()).pathname === '/places/_api')
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await refresh
      await page.waitForTimeout(100)
      assert({
        given: 'a zoomed map and a background refresh with unchanged places',
        should: 'show only the visible venue, preserve the viewport and keep offscreen markers available',
        actual: [
          await rowNames(),
          await canvas.getAttribute('data-fit-count'),
          await page.locator('.sky-places-pin').count(),
          await preview.getAttribute('data-kept'),
          await page.title(),
        ],
        expected: [['Atlas drink'], initialFits, categories.length, 'true', 'sky · Places'],
      })
      await page.getByRole('button', { name: 'Close place preview', exact: true }).click()
      await capture('11-map-area')
      await viewport(48.87, 48.86, 2.31, 2.3)
      await page.getByRole('link', { name: 'Open Atlas eat', exact: true }).waitFor()
      assert({
        given: 'a pan to another venue',
        should: 'replace the sidebar results',
        actual: await rowNames(),
        expected: ['Atlas eat'],
      })
      await viewport(1, 0, 1, 0)
      await page.getByRole('heading', { name: 'No places in this map area', exact: true }).waitFor()
      await page.getByText('0 on map', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Show all places on map', exact: true }).click()
      await page.getByText(`${categories.length} on map`, { exact: true }).waitFor()
      await viewport(48.86, 48.85, 2.3, 2.29)
      await page.getByText('1 on map', { exact: true }).waitFor()
      await page.getByRole('textbox', { name: 'Search your places', exact: true }).fill('Atlas eat')
      await page.getByRole('link', { name: 'Open Atlas eat', exact: true }).waitFor()
      assert({
        given: 'a search for an offscreen venue',
        should: 'fit the matching place and update the sidebar',
        actual: await rowNames(),
        expected: ['Atlas eat'],
      })
      await page.getByRole('textbox', { name: 'Search your places', exact: true }).fill('')
      await page.getByText(`${categories.length} on map`, { exact: true }).waitFor()
      await viewport(48.86, 48.85, 2.3, 2.29)
      await page.getByText('1 on map', { exact: true }).waitFor()
      const categoryViewport = await canvas.getAttribute('data-viewport')
      await page.getByRole('combobox', { name: 'Filter by category', exact: true }).click()
      await page.getByRole('option', { name: 'Restaurant', exact: true }).click()
      await page.getByRole('heading', { name: 'No places in this map area', exact: true }).waitFor()
      assert({
        given: 'a category whose places are outside the current map area',
        should: 'update the markers without changing the zoom, center or bounds',
        actual: [
          await rowNames(),
          await canvas.getAttribute('data-viewport'),
          await page.locator('.sky-places-pin').count(),
        ],
        expected: [[], categoryViewport, 1],
      })
      await capture('15-category-filter-stays-zoomed')
      await page.getByRole('button', { name: 'Clear category filter', exact: true }).click()
      await page.getByText('1 on map', { exact: true }).waitFor()
      assert({
        given: 'a cleared category filter',
        should: 'restore matching places in the same map area',
        actual: [await rowNames(), await canvas.getAttribute('data-viewport')],
        expected: [['Atlas drink'], categoryViewport],
      })
      await page.getByRole('combobox', { name: 'Filter by category', exact: true }).click()
      await page.getByRole('option', { name: 'Restaurant', exact: true }).click()
      await page.getByText('0 on map', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Show all places on map', exact: true }).click()
      await page.getByText('1 on map', { exact: true }).waitFor()
      assert({
        given: 'a category filter',
        should: 'include legacy restaurant records',
        actual: await rowNames(),
        expected: ['Atlas eat'],
      })
      await page.getByRole('textbox', { name: 'Search your places', exact: true }).fill('missing sample')
      await page.getByRole('heading', { name: 'No places found', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
      await page.getByText(`${categories.length} on map`, { exact: true }).waitFor()
      await page.getByRole('button', { name: '1 without a map location · View list', exact: true }).click()
      await page.getByRole('link', { name: 'Open Atlas Unmapped', exact: true }).waitFor()
      assert({
        given: 'a place without coordinates',
        should: 'remain accessible with every matching place in List view',
        actual: (await rowNames()).length,
        expected: categories.length + 1,
      })
      await page.getByRole('button', { name: 'Map', exact: true }).click()
      await page.getByText(`${categories.length} on map`, { exact: true }).waitFor()
      await page.setViewportSize({ width: 390, height: 844 })
      await viewport(48.86, 48.85, 2.3, 2.29)
      await page.getByText('1 on map', { exact: true }).waitFor()
      await capture('12-map-area-mobile')
      assert({
        given: 'the same map on a phone',
        should: 'filter results without horizontal overflow',
        actual: [await rowNames(), await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)],
        expected: [['Atlas drink'], false],
      })
      await page.getByRole('button', { name: 'Select Atlas drink', exact: true }).click()
      await preview.getByRole('link', { name: 'Apple Maps', exact: true }).waitFor()
      await capture('14-mobile-popup')
      const popupBox = await preview.boundingBox(),
        mapBox = await canvas.boundingBox()
      assert({
        given: 'a selected marker on a phone',
        should: 'keep both map links and the popup inside the map',
        actual: [
          await preview.getByRole('link', { name: 'Google Maps', exact: true }).isVisible(),
          Boolean(
            popupBox &&
            mapBox &&
            popupBox.x >= mapBox.x &&
            popupBox.x + popupBox.width <= mapBox.x + mapBox.width &&
            popupBox.y >= mapBox.y &&
            popupBox.y + popupBox.height <= mapBox.y + mapBox.height,
          ),
        ],
        expected: [true, true],
      })
      await page.evaluate(() => window.dispatchEvent(new Event('sky-places-map-error')))
      await page.getByRole('heading', { name: 'Map unavailable', exact: true }).waitFor()
      await page.getByRole('link', { name: 'Open Atlas Unmapped', exact: true }).waitFor()
      assert({
        given: 'a map failure after zooming',
        should: 'restore all matching rows',
        actual: (await rowNames()).length,
        expected: categories.length + 1,
      })
      await page.getByRole('link', { name: 'Open Atlas eat', exact: true }).click()
      await page.waitForFunction(() => document.title === 'sky · Atlas eat')
      await page.goBack()
      await page.waitForFunction(() => document.title === 'sky · Places')
      await page.goForward()
      await page.waitForFunction(() => document.title === 'sky · Atlas eat')
      await page.reload()
      await page.waitForFunction(() => document.title === 'sky · Atlas eat')
      assert({
        given: 'map interactions, direct loads and browser navigation',
        should: 'keep the screen title and saved Maps link in sync without browser errors',
        actual: [
          await page.title(),
          await page.getByRole('link', { name: 'Open in Google Maps', exact: true }).getAttribute('href'),
          errors,
        ],
        expected: ['sky · Atlas eat', sharedGoogleLink, []],
      })
    } finally {
      await browser?.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
)

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
