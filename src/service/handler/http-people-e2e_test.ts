import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { readProfileEvidence } from '#lib/linkedin/extract.ts'
import type { LinkedInImport, LinkedInImportHost } from '#lib/linkedin/types.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { Store } from '../store.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import type { SettingsData } from './settings/mod.ts'

test(
  {
    name: 'People & Orgs: create, import review, edit, source notes, real routes, mobile and selection preservation',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120_000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-people-browser-'))
    const peopleDir = path.join(root, 'people'),
      orgsDir = path.join(root, 'orgs')
    await Promise.all([mkdir(peopleDir), mkdir(orgsDir)])
    const store = await MarkdownStore.build({ peopleDirs: [peopleDir], orgDirs: [orgsDir] })
    const scores = new Store()
    let job: LinkedInImport | null = null
    let polls = 0
    const linkedIn: LinkedInImportHost = {
      start: async (url) => {
        polls = 0
        return (job = {
          id: '11111111-1111-4111-8111-111111111111',
          url,
          status: 'running',
          stage: 'Sign in to LinkedIn in the browser window.',
        })
      },
      status: async () => {
        if (job?.status === 'running' && ++polls >= 2)
          job = {
            ...job,
            status: 'complete',
            stage: 'Ready',
            draft: {
              url: job.url,
              name: 'Jane Doe',
              title: 'Design lead',
              location: 'Portland',
              about: 'A first paragraph.\n\nA second paragraph.',
              current: [{ name: 'Atlas', linkedin: 'https://www.linkedin.com/company/atlas-new-example/' }],
              past: [{ name: 'Cedar Foundation' }],
            },
          }
        return job
      },
      cancel: async () => {
        if (job) job = { ...job, status: 'failed', error: 'Import cancelled.' }
      },
    }
    const settings: SettingsData = {
      calendar: { classifyEvents: false },
      theme: 'light',
      experimental: { contextPreflight: false, workstreams: false },
      textSize: 'default',
      voice: { current: 'marin', researcherCurrent: 'ash', groups: { male: ['ash'], female: ['marin'] } },
      models: [],
      profiles: [],
      writingVoice: { profile: 'sample', choices: [] },
      providers: [],
      memoryNotes: 0,
      notebook: {
        dir: '/Notebook',
        userDataDir: '/Notebook-Data',
        inputDir: '/Input',
        outputDir: '/Output',
        editor: 'code',
        editors: ['code'],
      },
      about: { version: 'sample', date: '2026-02-12' },
      advanced: { path: '/Config/config.jsonc', exists: true, version: 1, sections: [] },
    }
    const app = new Hono()
    app.get('/settings/_api/settings', (c) => c.json(settings))
    app.route(
      '/',
      createTestHttpApp([peopleDir, orgsDir], {
        store: scores,
        markdownStore: store,
        people: {
          peopleDir,
          orgsDir,
          stateDir: path.join(root, '.state'),
          now: () => new ZonedDateTime('2026-02-12 09:34', 'America/Chicago'),
          linkedIn,
        },
      }),
    )
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address.')
    let browser
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const base = `http://127.0.0.1:${address.port}`
      const capture = async (name: string) => {
        const dir = env.get('SKY_PEOPLE_SCREENSHOTS')
        if (dir) {
          await mkdir(dir, { recursive: true })
          await page.waitForTimeout(250)
          await page.screenshot({ path: path.join(dir, `${name}.png`) })
        }
      }
      await page.goto(`${base}/settings/appearance`)
      await page.getByRole('link', { name: 'People & Orgs', exact: true }).waitFor()
      const above = await page.evaluate(() => {
        const link = document.querySelector('.sky-people-nav')!
        const heading = document.querySelector('.sky-side-label')!
        return link.getBoundingClientRect().bottom <= heading.getBoundingClientRect().top
      })
      await page.getByRole('link', { name: 'People & Orgs', exact: true }).click()
      await page.getByRole('heading', { name: 'Start with someone you know' }).waitFor()
      await capture('01-empty-people')
      await page.getByRole('link', { name: /Organizations 0/ }).click()
      await page.getByRole('button', { name: 'Add your first organization' }).click()
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Atlas')
      await page
        .getByRole('combobox', { name: 'Websites', exact: true })
        .fill('https://www.linkedin.com/company/atlas-old-example/')
      await page.getByRole('combobox', { name: 'Websites', exact: true }).press('Enter')
      await page
        .getByRole('textbox', { name: 'About', exact: true })
        .fill('## Overview\n\nOverview\n\nA small research studio.\n\n## Background\n\n## Info\n')
      await page.getByRole('dialog').getByRole('button', { name: 'Add org', exact: true }).click()
      await page.getByRole('heading', { name: 'Atlas', exact: true }).waitFor()
      const orgPath = new URL(page.url()).pathname
      const headings = await page.locator('.sky-people-profile-content h2').allTextContents()
      await page.getByRole('link', { name: 'People & Orgs', exact: true }).click()
      await page.getByRole('button', { name: 'Add your first person' }).click()
      await page
        .getByRole('textbox', { name: 'Start with LinkedIn' })
        .fill('https://www.linkedin.com/in/jane-doe-example/')
      await page.getByRole('button', { name: 'Import profile', exact: true }).click()
      await page.getByText('The profile is ready to review. Edit anything before saving.').waitFor()
      const beforeSave = { people: store.people.size, orgs: store.orgs.size }
      const needsChoice = await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Add person', exact: true })
        .isDisabled()
      await page.getByRole('combobox', { name: 'Choose Atlas', exact: true }).click()
      await page
        .getByRole('option', { name: 'Atlas · https://www.linkedin.com/company/atlas-old-example/', exact: true })
        .click()
      await page.getByRole('textbox', { name: 'Role', exact: true }).fill('Head of design')
      await capture('02-import-review')
      await page.getByRole('dialog').getByRole('button', { name: 'Add person', exact: true }).click()
      await page.getByRole('heading', { name: 'Jane Doe', exact: true }).waitFor()
      const personPath = new URL(page.url()).pathname
      await capture('03-person')
      await page.reload()
      await page.getByRole('heading', { name: 'Jane Doe', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByRole('textbox', { name: 'Role', exact: true }).fill('Design partner')
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await page.getByText('Design partner', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Add note', exact: true }).click()
      await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Follow up about the workshop.')
      await page.getByRole('button', { name: 'Save note', exact: true }).click()
      await page.getByText('Follow up about the workshop.', { exact: true }).waitFor()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.bringToFront()
      await page.waitForTimeout(150)
      const personFile = store.people.getAll().paths[0]
      const selection = await page.evaluate(() => {
        const paragraphs = document.querySelectorAll('.sky-people-prose p')
        const range = document.createRange()
        range.setStart(paragraphs[0].firstChild!, 2)
        range.setEnd(paragraphs[1].firstChild!, 8)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        return selection.toString()
      })
      const refreshed = page.waitForResponse((response) => response.url().includes('/people/_api/profile?'))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await refreshed
      await page.waitForTimeout(100)
      const afterRefresh = await page.evaluate(() => window.getSelection()?.toString())
      await writeFile(personFile, (await readFile(personFile, 'utf8')) + '\nAn external notebook update.\n')
      store.set(personFile, await readFile(personFile, 'utf8'))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await page.getByText('An external notebook update.', { exact: true }).waitFor()
      await page.locator('.sky-people-inline-orgs').getByRole('link', { name: 'Atlas', exact: true }).click()
      await page.getByRole('heading', { name: 'Atlas', exact: true }).waitFor()
      const members = await page.locator('.sky-people-row strong').allTextContents()
      await capture('04-organization')
      await page.getByRole('link', { name: 'People & Orgs', exact: true }).click()
      await page.getByRole('textbox', { name: 'Search people', exact: true }).fill('nobody')
      await page.getByRole('heading', { name: 'No matches', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Clear filters' }).click()
      await page.getByRole('link', { name: /Jane Doe/ }).waitFor()
      await capture('05-list')
      await page.setViewportSize({ width: 390, height: 844 })
      await capture('06-mobile-list')
      await page.getByRole('link', { name: /Jane Doe/ }).click()
      await page.getByRole('heading', { name: 'Jane Doe', exact: true }).waitFor()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      await capture('07-mobile-person')
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByRole('textbox', { name: 'Name', exact: true }).waitFor()
      await capture('08-mobile-edit')
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      settings.theme = 'dark'
      await page.reload()
      await page.getByRole('heading', { name: 'Jane Doe', exact: true }).waitFor()
      await capture('09-dark')
      const sourcePage = await browser.newPage()
      await sourcePage.setContent(
        '<main><h1>Jane Doe</h1><section><h2>Experience</h2><p>Atlas · Design lead · Present</p><a href="https://www.linkedin.com/company/atlas-example/">Atlas</a></section><aside>Unrelated person</aside><section><h2>People also viewed</h2>Another person</section></main>',
      )
      const evidence = await readProfileEvidence(sourcePage, 'https://www.linkedin.com/in/jane-doe-example/')
      assert({
        given: 'the real app with an isolated notebook and a scripted LinkedIn draft',
        should: 'keep import review separate from writes, support every profile flow and preserve selection',
        actual: {
          above,
          beforeSave,
          needsChoice,
          people: store.people.size,
          orgs: store.orgs.size,
          path: personPath,
          orgPath,
          headings,
          hash: new URL(page.url()).hash,
          members,
          selection: afterRefresh === selection,
          overflow,
          evidence: evidence.text.includes('Unrelated person') || evidence.text.includes('Another person'),
          name: evidence.name,
          errors,
        },
        expected: {
          above: true,
          beforeSave: { people: 0, orgs: 1 },
          needsChoice: true,
          people: 1,
          orgs: 2,
          path: '/people/jane-doe',
          orgPath: '/orgs/atlas',
          headings: ['Overview'],
          hash: '',
          members: ['Jane Doe'],
          selection: true,
          overflow: false,
          evidence: false,
          name: 'Jane Doe',
          errors: [],
        },
      })
      const seed = async (folder: string, name: string, yaml = '') => {
        const file = path.join(root, folder, `${name.replaceAll(' ', '-')}.md`)
        const raw = `---\nname: ${name}\n${yaml}---\n\n# ${name}\n\n## Overview\n\n## Background\n`
        await writeFile(file, raw)
        store.set(file, raw)
      }
      await seed('people', 'Jane Adams')
      await seed('people', 'Jane Zephyr')
      await seed('orgs', 'Atlas Alpha', 'tags: Organization/Company\n')
      await seed('orgs', 'Atlas Zephyr', 'tags: Organization/Company\n')
      scores.people.add('Jane Adams')
      scores.people.add('Jane Zephyr')
      scores.organizations.add('Atlas Alpha')
      scores.organizations.add('Atlas Zephyr')
      const today = new PlainDate('2026-02-12')
      scores.recordInteraction('Jane Adams', today.ymd, 2, today)
      scores.recordInteraction('Jane Zephyr', today.ymd, 50, today)
      scores.recordOrgInteraction('Atlas Alpha', today.ymd, 2, today)
      scores.recordOrgInteraction('Atlas Zephyr', today.ymd, 50, today)
      settings.theme = 'light'
      await page.setViewportSize({ width: 1440, height: 1050 })
      await page.goto(`${base}/people`)
      const search = page.getByRole('textbox', { name: 'Search people', exact: true })
      await search.fill('jane')
      const rankedPeople = await page.locator('.sky-people-row strong').allTextContents()
      const searchOrder = await page.getByRole('combobox', { name: 'Sort profiles' }).inputValue()
      await capture('10-people-search')
      await search.fill('')
      const alphabetical = await page.locator('.sky-people-row strong').allTextContents()
      await page.getByRole('combobox', { name: 'Filter by organization' }).click()
      const orgOptions = await page.getByRole('option').allTextContents()
      await page.keyboard.press('Escape')
      scores.recordInteraction('Jane Adams', today.ymd, 100, today)
      const rescored = page.waitForResponse((response) => response.url() === `${base}/people/_api`)
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await rescored
      await search.fill('jane')
      await page.waitForFunction(() => document.querySelector('.sky-people-row strong')?.textContent === 'Jane Adams')
      const refreshedRank = await page.locator('.sky-people-row strong').allTextContents()
      await page.getByRole('link', { name: /Organizations 4/ }).click()
      await page.getByRole('textbox', { name: 'Search organizations', exact: true }).fill('atlas')
      const rankedOrgs = await page.locator('.sky-people-row strong').allTextContents()
      await capture('11-org-search')
      await page.getByRole('combobox', { name: 'Filter by type' }).click()
      const types = await page.getByRole('option').allTextContents()
      await page.keyboard.press('Escape')
      await page.getByRole('link', { name: /Atlas Zephyr/ }).click()
      await page.getByRole('heading', { name: 'Atlas Zephyr', exact: true }).waitFor()
      const emptySections = await page.locator('.sky-people-profile-content h2').allTextContents()
      const canAddNote = await page.getByRole('button', { name: 'Add note', exact: true }).isVisible()
      const sourceHref = await page.getByRole('link', { name: 'Open notebook file' }).getAttribute('href')
      await page.goto(`${base}/people/people/${path.relative(peopleDir, personFile)}`)
      await page.getByRole('heading', { name: 'Jane Doe', exact: true }).waitFor()
      assert({
        given: 'name searches, independently refreshed interaction scores and empty categories',
        should: 'rank both types by score, restore alphabetical browsing and omit empty categories',
        actual: {
          rankedPeople,
          searchOrder,
          alphabetical,
          orgOptions,
          refreshedRank,
          rankedOrgs,
          types,
          emptySections,
          canAddNote,
          sourceHref,
          redirected: new URL(page.url()).pathname,
          errors,
        },
        expected: {
          rankedPeople: ['Jane Zephyr', 'Jane Adams', 'Jane Doe'],
          searchOrder: 'Most relevant',
          alphabetical: ['Jane Adams', 'Jane Doe', 'Jane Zephyr'],
          orgOptions: ['Atlas'],
          refreshedRank: ['Jane Adams', 'Jane Zephyr', 'Jane Doe'],
          rankedOrgs: ['Atlas Zephyr', 'Atlas Alpha', 'Atlas'],
          types: ['Companies', 'Not specified'],
          emptySections: [],
          canAddNote: true,
          sourceHref: '/explorer/orgs/Atlas-Zephyr.md',
          redirected: '/people/jane-doe',
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
