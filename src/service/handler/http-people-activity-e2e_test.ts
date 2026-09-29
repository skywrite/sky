import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from './httpTestHelpers.ts'

test(
  {
    name: 'People activity unlinks source rel on desktop and phone, retains other fields, and allows retry',
    ignore: env.get('SKY_BROWSER_TESTS') !== '1',
    timeout: 60_000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sky-people-activity-'))
    const peopleDir = path.join(root, 'people')
    const orgsDir = path.join(root, 'orgs')
    const timeDir = path.join(root, 'time')
    const desktop = 'time/2026/W07/02-12/actions/notes/Atlas.md'
    const phone = 'time/2026/W07/02-11/actions/notes/Widget.md'
    const meeting = 'time/2026/W07/02-10/actions/meetings/Planning.md'
    const message = 'time/2026/W07/02-09/actions/messages/Hello.md'
    const note = (summary: string) =>
      `---\nsummary: ${summary}\nrel: [Jay, projects/Atlas]\ncustom: keep\n---\n\n# Notes\n\nOriginal notes.\n`
    await Promise.all([peopleDir, orgsDir, timeDir].map((dir) => mkdir(dir)))
    for (const [file, raw] of Object.entries({
      'people/Jane-Doe.md': '---\nname: [Jane Doe, Jay]\n---\n',
      [desktop]: note('Atlas planning'),
      [phone]: note('Widget planning'),
      [meeting]: '---\nsummary: Planning meeting\nwho: Jane Doe\n---\n',
      [message]: '---\nsummary: Hello\nrel: [Jane Doe]\nfrom: Jane Doe\n---\n\n# Message\n',
    })) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await writeFile(path.join(root, file), raw)
    }
    const store = await MarkdownStore.build({ peopleDirs: [peopleDir], orgDirs: [orgsDir], timeDirs: [timeDir] })
    const app = createTestHttpApp([peopleDir, orgsDir, timeDir], {
      markdownStore: store,
      people: { peopleDir, orgsDir, stateDir: path.join(root, '.state') },
    })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    let browser
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing test server address.')
      browser = await chromium.launch({
        headless: true,
        executablePath: env.get('SKY_BROWSER_EXECUTABLE') || undefined,
      })
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const read = (file: string) => readFile(path.join(root, file), 'utf8')
      const capture = async (name: string) => {
        const dir = env.get('SKY_PEOPLE_SCREENSHOTS')
        if (!dir) return
        await mkdir(dir, { recursive: true })
        await page.waitForTimeout(250)
        await page.screenshot({ path: path.join(dir, `${name}.png`) })
      }
      await page.goto(`http://127.0.0.1:${address.port}/people/jane-doe`)
      const activity = page.locator('.sky-people-activity')
      const desktopButton = page.getByRole('button', { name: 'Unlink Atlas planning from Jane Doe', exact: true })
      await desktopButton.waitFor()
      assert({
        given: 'activity from rel and who',
        should: 'offer unlink only for the three rel connections',
        actual: [await activity.locator('li').count(), await activity.getByRole('button').count()],
        expected: [4, 3],
      })
      await capture('activity-desktop')
      let release!: () => void
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      let started!: () => void
      const saving = new Promise<void>((resolve) => {
        started = resolve
      })
      await page.route('**/people/_api/activity/unlink', async (route) => {
        started()
        await pending
        await route.continue()
      })
      await desktopButton.click()
      await saving
      const disabled = await activity
        .getByRole('button')
        .evaluateAll((buttons) => buttons.every((button) => (button as HTMLButtonElement).disabled))
      release()
      await desktopButton.waitFor({ state: 'detached' })
      await page.unroute('**/people/_api/activity/unlink')
      assert({
        given: 'the desktop unlink button clicked while the save is pending',
        should: 'prevent duplicate writes, remove the row, and update only rel in the source file',
        actual: [disabled, await read(desktop)],
        expected: [
          true,
          '---\nsummary: Atlas planning\nrel:\n  - projects/Atlas\ncustom: keep\n---\n\n# Notes\n\nOriginal notes.\n',
        ],
      })

      await page.setViewportSize({ width: 430, height: 900 })
      const phoneButton = page.getByRole('button', { name: 'Unlink Widget planning from Jane Doe', exact: true })
      await page.route('**/people/_api/activity/unlink', (route) =>
        route.fulfill({ status: 409, contentType: 'application/json', body: '{"message":"Please retry unlinking."}' }),
      )
      await phoneButton.click()
      await page.getByRole('alert').filter({ hasText: 'Please retry unlinking.' }).waitFor()
      assert({
        given: 'a failed save on the phone',
        should: 'keep the activity and original file available for retry',
        actual: [await phoneButton.isEnabled(), await read(phone)],
        expected: [true, note('Widget planning')],
      })
      await page.unroute('**/people/_api/activity/unlink')
      await capture('activity-phone')
      const bounds = await phoneButton.boundingBox()
      await phoneButton.focus()
      await phoneButton.press('Enter')
      await phoneButton.waitFor({ state: 'detached' })
      const messageButton = page.getByRole('button', { name: 'Unlink Hello from Jane Doe', exact: true })
      await messageButton.click()
      await messageButton.waitFor({ state: 'detached' })
      await page.reload()
      await activity.getByRole('link', { name: 'Hello', exact: true }).waitFor()
      assert({
        given: 'a keyboard retry on the phone and a message linked through both rel and from',
        should: 'fit the action onscreen, persist unlink after reload, and retain the from and who activity',
        actual: [
          Boolean(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 430),
          await activity.getByRole('link').allTextContents(),
          await activity.getByRole('button').count(),
          await read(phone),
          await read(message),
          errors,
        ],
        expected: [
          true,
          ['Planning meeting', 'Hello'],
          0,
          '---\nsummary: Widget planning\nrel:\n  - projects/Atlas\ncustom: keep\n---\n\n# Notes\n\nOriginal notes.\n',
          '---\nsummary: Hello\nrel: []\nfrom: Jane Doe\n---\n\n# Message\n',
          [],
        ],
      })
    } finally {
      await browser?.close()
      server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
