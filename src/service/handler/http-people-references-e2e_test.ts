import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chromium } from 'playwright'
import { TRANSCRIPTION_MODELS } from '#commands/all/audio/transcript/lib/models.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from './httpTestHelpers.ts'
import type { SettingsData } from './settings/mod.ts'

test(
  {
    name: "People & Orgs: a profile's old spelling is updated in other files, and a rename offers the same",
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 120_000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-people-references-'))
    const peopleDir = path.join(root, 'people')
    const orgsDir = path.join(root, 'orgs')
    const timeDir = path.join(root, 'time')
    const write = async (file: string, raw: string) => {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await writeFile(path.join(root, file), raw)
    }
    const meeting = 'time/2026/W07/02-10/actions/meetings/09-00_Zoom_Planning.md'
    const message = 'time/2026/W07/02-11/actions/messages/10-00_Email_Hello.md'
    const note = 'time/2026/W07/02-12/actions/notes/11-00_Atlas.md'
    const chat = 'time/2026/W07/02-12/actions/ai-chats/12-00_Planning.md'
    await write('people/2026/ja/Jane-Doe.md', '---\nname: [Jane Doe, Jane Doh]\ntitle: Designer\n---\n\n# Jane Doe\n')
    await write(meeting, '---\nwho: Alex Kim, Jane Doh\nsummary: Planning\n---\n\nJane Doh led it.\n')
    await write(message, '---\nfrom: Jane Doh\nto: Alex Kim\nsummary: Hello\n---\n')
    await write(note, '---\nsummary: Atlas notes\nrel:\n  - Jane Doh\n  - projects/Atlas\n---\n')
    await write(
      chat,
      '---\ntitle: Planning chat\n---\n\nA question.\n\n<!-- CONTEXT-LOG\n{"turns":[{"universe":[{"path":"people/2026/ja/Jane-Doe.md"}]}]}\n-->\n',
    )
    await write('people/2026/sa/Sam-Rivers.md', '---\nname: Sam Rivera\n---\n\n# Sam Rivera\n')
    await mkdir(orgsDir, { recursive: true })
    const store = await MarkdownStore.build({ peopleDirs: [peopleDir], orgDirs: [orgsDir], timeDirs: [timeDir] })
    const settings: SettingsData = {
      transcription: {
        value: 'openai/gpt-transcribe',
        choices: TRANSCRIPTION_MODELS.map((model) => ({ ...model, configured: model.provider === 'openai' })),
      },
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
      createTestHttpApp([peopleDir, orgsDir, timeDir], {
        markdownStore: store,
        people: {
          peopleDir,
          orgsDir,
          stateDir: path.join(root, '.state'),
          now: () => new ZonedDateTime('2026-02-12 09:34', 'America/Chicago'),
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
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const capture = async (name: string) => {
        const dir = env.get('SKY_PEOPLE_SCREENSHOTS')
        if (!dir) return
        await mkdir(dir, { recursive: true })
        await page.waitForTimeout(250)
        await page.screenshot({ path: path.join(dir, `${name}.png`) })
      }
      const read = (file: string) => readFile(path.join(root, file), 'utf8')

      await page.goto(`http://127.0.0.1:${address.port}/people/jane-doe`)
      const notice = page.locator('.sky-people-spellings')
      await notice.waitFor()
      const noticeText = await notice.innerText()
      await capture('references-01-notice')
      await page.getByRole('button', { name: 'Update to Jane Doe' }).click()
      await page.getByRole('button', { name: 'Update 3 files' }).waitFor()
      const groups = await page.locator('.sky-people-reference-preview summary').allInnerTexts()
      await page.evaluate(() => {
        for (const details of document.querySelectorAll('.sky-people-reference-preview details'))
          (details as HTMLDetailsElement).open = true
      })
      await capture('references-02-preview')
      await page.getByRole('button', { name: 'Update 3 files' }).click()
      await page.getByText('Updated 3 files.').waitFor()
      await capture('references-03-done')
      await page.getByRole('button', { name: 'Done' }).click()
      await notice.waitFor({ state: 'detached' })
      assert({
        given: 'a profile whose old spelling a meeting, a message and a note still use',
        should: 'say so under the name, preview the three by kind, and update them in place',
        actual: [
          noticeText.replace(/\s+/g, ' ').trim(),
          groups.map((group) => group.replace(/\s+/g, ' ').trim()),
          await read(meeting),
          await read(message),
          await read(note),
        ],
        expected: [
          'Also written Jane Doh in 3 files. Update to Jane Doe',
          ['Meetings 1', 'Messages 1', 'Notes 1'],
          '---\nwho: Alex Kim, Jane Doe\nsummary: Planning\n---\n\nJane Doh led it.\n',
          '---\nfrom: Jane Doe\nto: Alex Kim\nsummary: Hello\n---\n',
          '---\nsummary: Atlas notes\nrel:\n  - Jane Doe\n  - projects/Atlas\n---\n',
        ],
      })

      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Jane Q. Doe')
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await page.getByRole('button', { name: 'Update 4 files' }).waitFor()
      const fileLine = await page.locator('.sky-people-reference-file').innerText()
      await capture('references-04-after-rename')
      await page.getByRole('button', { name: 'Update 4 files' }).click()
      await page.getByText('Renamed the file to Jane-Q-Doe.md. Updated 4 files.').waitFor()
      await page.getByRole('button', { name: 'Done' }).click()
      await page.getByRole('heading', { name: 'Jane Q. Doe', exact: true }).waitFor()
      const moved = await read('people/2026/ja/Jane-Q-Doe.md').then(
        () => true,
        () => false,
      )
      const left = await read('people/2026/ja/Jane-Doe.md').then(
        () => true,
        () => false,
      )
      assert({
        given: 'the name changed in the editor',
        should:
          'offer the update for the name it replaced, rename the file, and point every file at the new name and file',
        actual: [
          fileLine.replace(/\s+/g, ' ').trim(),
          (await read(meeting)).split('\n')[1],
          (await read(message)).split('\n')[1],
          (await read(chat)).includes('"path":"people/2026/ja/Jane-Q-Doe.md"'),
          [moved, left],
          page.url().endsWith('/people/jane-doe'),
          errors,
        ],
        expected: [
          'File Jane-Doe.md → Jane-Q-Doe.md',
          'who: Alex Kim, Jane Q. Doe',
          'from: Jane Q. Doe',
          true,
          [true, false],
          true,
          [],
        ],
      })

      await page.goto(`http://127.0.0.1:${address.port}/people/sam-rivera`)
      await page.getByRole('button', { name: 'Rename file to Sam-Rivera.md' }).click()
      await page.getByRole('button', { name: 'Rename the file' }).click()
      await page.getByText('Renamed the file to Sam-Rivera.md.').waitFor()
      assert({
        given: 'a profile whose file name no longer matches its name, with no other spelling in use',
        should: 'offer the rename in its details and rename the file on its own',
        actual: await read('people/2026/sa/Sam-Rivera.md'),
        expected: '---\nname: Sam Rivera\n---\n\n# Sam Rivera\n',
      })
    } finally {
      await browser?.close()
      server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
