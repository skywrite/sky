import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import { readSrt } from './import/readback.ts'

const DAY = '2026-01-28'
const DAY_FILE = 'time/2026/W05/01-28/day.md'
const VIDEO = 'time/2026/W05/01-27/actions/videos/Loom_Atlas.md'
const CHAT = 'time/2026/W05/01-27/actions/ai-chats/09-00_Atlas.md'
const BRANCH = `${CHAT.slice(0, -3)}/10-00_Budget.md`
const MESSAGE = 'time/2026/W05/01-27/actions/messages/Email_Atlas.md'
const FILED = 'time/2026/W05/01-28/actions/videos/Loom_followup.md'
const SRT = '1\n00:00:00,000 --> 00:00:02,000\nHere is the Atlas follow-up.\n'

test(
  {
    name: 'link an earlier video before import, add a branch during review, and edit links after filing',
    timeout: 45000,
  },
  async (t) => {
    let base = ''
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: `---\ndate: ${DAY}\n---\n\n# ${DAY}\n`,
        tempPrefix: 'links-e2e-',
        file: DAY_FILE,
        day: true,
        store: true,
        files: {
          [VIDEO]:
            '---\nsummary: Atlas walkthrough\nfrom: Jane Doe\n---\n\n# Video\n\nThe original walkthrough explains the launch checklist.\n',
          [CHAT]: '---\nsummary: Atlas planning\n---\n\n# Atlas planning\n',
          [BRANCH]: `---\nsummary: Budget questions\nparent:\n  chat: ${CHAT}\n  turn: 2\n---\n\n# Budget questions\n\nThe branch explores the budget.\n`,
          [MESSAGE]:
            '---\nsummary: Atlas follow-up email\nfrom: Jane Doe\n---\n\n# Email\n\nThe message shares the decision.\n',
        },
        imports: {
          read: async () => readSrt(SRT, 'Atlas.srt'),
          suggestWhen: () => `${DAY} 10:00`,
          run: async function* () {
            let reply!: (answer: unknown) => void
            const answered = new Promise((resolve) => {
              reply = resolve
            })
            yield {
              type: 'prompt',
              id: 'review',
              request: { kind: 'text', prompt: { message: 'Any corrections?' } },
              reply,
            }
            await answered
            await mkdir(path.dirname(path.join(base, FILED)), { recursive: true })
            await writeFile(
              path.join(base, FILED),
              '---\nsummary: Atlas follow-up video\nrel:\n  - Existing context\n---\n\n# Follow-up\n\nThe transcript stays here.\n',
            )
            return { ok: true, file: FILED }
          },
        },
      },
      async ({ page, origin, file, errors }) => {
        base = file.slice(0, -DAY_FILE.length)
        await page.setViewportSize({ width: 1500, height: 1000 })
        // Make the fixture's relative dates independent of the machine's clock.
        await page.route('**/docs/_api/links?*', async (route) => {
          const response = await route.fetch()
          const data = await response.json()
          await route.fulfill({ response, json: { ...data, today: DAY } })
        })
        await page.goto(`${origin}/${DAY}`)
        await page.locator('.sky-day').waitFor()
        await page.locator('.sky-day').evaluate((target, text) => {
          const transfer = new DataTransfer()
          transfer.items.add(new File([text], 'Atlas.srt', { type: 'text/plain' }))
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
        }, SRT)
        await page.getByText('New video from a transcript', { exact: true }).waitFor()
        await page.getByRole('button', { name: '+ Add link', exact: true }).click()
        await page.getByRole('button', { name: 'Link Atlas walkthrough', exact: true }).waitFor()
        await page.getByRole('button', { name: 'Preview Atlas walkthrough' }).click()
        await page.getByText('The original walkthrough explains the launch checklist.', { exact: true }).waitFor()
        const previewDir = env.get('SKY_LINKS_SCREENSHOTS')
        if (previewDir) await page.screenshot({ path: path.join(previewDir, 'desktop.png'), animations: 'disabled' })
        const popup = page.waitForEvent('popup')
        await page.getByRole('link', { name: 'Open full record ↗' }).click()
        await (await popup).close()
        await page.getByRole('combobox', { name: 'Link type', exact: true }).click()
        await page.getByRole('option', { name: 'Videos', exact: true }).click()
        await page.getByRole('combobox', { name: 'Link date', exact: true }).click()
        await page.getByRole('option', { name: 'Yesterday', exact: true }).click()
        await page.getByRole('button', { name: 'Link Atlas walkthrough', exact: true }).click()
        await page.locator('.sky-import-links a').filter({ hasText: 'Atlas walkthrough' }).waitFor()
        await page.getByRole('button', { name: 'Start', exact: true }).click()
        await page.getByRole('button', { name: 'Looks right', exact: true }).waitFor()
        await page.reload()
        await page.locator('.sky-import-links a').filter({ hasText: 'Atlas walkthrough' }).waitFor()
        await page.getByRole('button', { name: '+ Add link', exact: true }).click()
        await page.getByLabel('Search notebook links').fill('budget')
        await page.getByText('From turn 2 of Atlas planning', { exact: true }).waitFor()
        await page.getByLabel('Search notebook links').press('ArrowDown')
        await page.keyboard.press('Enter')
        await page.locator('.sky-import-links a').filter({ hasText: 'Budget questions' }).waitFor()
        await page.getByRole('button', { name: 'Looks right', exact: true }).click()
        await page.getByRole('link', { name: 'Open it', exact: true }).waitFor()
        await page.locator('[data-section="links"] a').filter({ hasText: 'Budget questions' }).waitFor()
        const saved = await readFile(path.join(base, FILED), 'utf8')
        assert({
          given: 'a link chosen before starting and another during review',
          should: 'retain both in rel alongside extracted context',
          actual: [
            saved.includes('2026-01-27/actions/videos/Loom_Atlas'),
            saved.includes('2026-01-27/actions/ai-chats/09-00_Atlas/10-00_Budget'),
            saved.includes('Existing context'),
            saved.endsWith('The transcript stays here.\n'),
          ],
          expected: [true, true, true, true],
        })

        await page.setViewportSize({ width: 430, height: 900 })
        await page.getByRole('button', { name: '+ Add link', exact: true }).click()
        await page.getByLabel('Search notebook links').fill('follow-up email')
        await page.getByRole('button', { name: 'Link Atlas follow-up email', exact: true }).waitFor()
        if (previewDir) await page.screenshot({ path: path.join(previewDir, 'mobile.png'), animations: 'disabled' })
        await page.getByRole('button', { name: 'Link Atlas follow-up email', exact: true }).click()
        await page.locator('[data-section="links"] a').filter({ hasText: 'Atlas follow-up email' }).waitFor()
        await page.getByRole('button', { name: 'Remove link to Budget questions' }).click()
        await page
          .locator('[data-section="links"] a')
          .filter({ hasText: 'Budget questions' })
          .waitFor({ state: 'detached' })
        const edited = await readFile(path.join(base, FILED), 'utf8')
        assert({
          given: 'links edited after filing on a phone',
          should: 'add the message and remove only the chosen branch',
          actual: [
            edited.includes('actions/messages/Email_Atlas'),
            edited.includes('10-00_Budget'),
            edited.includes('actions/videos/Loom_Atlas'),
            edited.includes('Existing context'),
          ],
          expected: [true, false, true, true],
        })
        const backlinks = await (await page.request.get(`${origin}/docs/_api/backlinks?path=${VIDEO}`)).json()
        assert({
          given: 'the original video',
          should: 'link back to the new video by its title',
          actual: backlinks.items.map((i: { label: string }) => i.label),
          expected: ['Atlas follow-up video'],
        })
        assert({
          given: 'desktop and phone link editing',
          should: 'raise no browser errors',
          actual: errors,
          expected: [],
        })
      },
    )
  },
)
