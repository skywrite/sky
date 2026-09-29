import type { PromptEvent } from '#commands/lib/core/runCommand.ts'
import type { PromptRequest } from '#commands/lib/prompt/Prompter.ts'
import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import { readAudio } from './import/readback.ts'

const FILES = [
  'time/2031/W11/03-16/journal/2031-03-16_091234_Feeling-Rested-After-A-Long-Walk.md',
  'time/2031/W11/03-16/journal/2031-03-16_091234_Grateful-For-Help-With-Atlas-Today.md',
]
const JOURNAL =
  '---\ntags: Journal/Health\nsummary: Feeling Rested After A Long Walk\n---\n\n# Health\n\nThe walk helped me feel rested.\n'

test(
  { name: 'journal import reviews names before types and opens all results in Explorer tabs once', timeout: 60000 },
  async (t) => {
    let chosen: unknown
    const replies: string[] = []
    const ask = (id: string, request: PromptRequest) => {
      let reply!: (answer: unknown) => void
      const answer = new Promise<unknown>((resolve) => {
        reply = resolve
      })
      const event: PromptEvent = { type: 'prompt', id, request, reply }
      return { answer, event }
    }
    await runWysiwygE2e(
      t,
      {
        tempPrefix: 'sky-journal-import-',
        file: FILES[0],
        initialMarkdown: JOURNAL,
        files: { [FILES[1]]: JOURNAL.replaceAll('Health', 'Gratitude') },
        day: true,
        imports: {
          read: async ({ size }) => readAudio(size, 90),
          run: async function* () {
            yield {
              type: 'stage',
              id: 'names',
              label: 'Checking names',
              detail: null,
              command: 'audio:transcript:clean',
              depth: 2,
            }
            const names = ask('names', {
              kind: 'form',
              prompt: {
                title: 'Interactive Review',
                items: [
                  {
                    id: 'name',
                    label: 'Name spelling',
                    problem: 'Jain Doe',
                    contexts: ['Jain Doe helped with Atlas.'],
                    occurrences: 1,
                    suggestion: 'Jane Doe',
                    alternatives: [],
                  },
                ],
              },
            })
            yield names.event
            await names.answer
            replies.push('names')
            yield {
              type: 'stage',
              id: 'journal-types',
              label: 'Choosing journal types',
              detail: null,
              command: 'journal:new',
              depth: 1,
            }
            const types = ask('types', {
              kind: 'multiselect',
              prompt: {
                message: 'Choose journal types',
                initial: ['Health', 'Gratitude'],
                options: [
                  { value: 'Health', label: 'Health', hint: 'Rest and walking.' },
                  { value: 'Gratitude', label: 'Gratitude', hint: 'Jane Doe helped with Atlas.' },
                  { value: 'Leadership', label: 'Leadership' },
                ],
              },
            })
            yield types.event
            chosen = await types.answer
            replies.push('types')
            return { ok: true, file: FILES[0], files: FILES }
          },
        },
      },
      async ({ page, origin, errors }) => {
        const upload = await page.request.post(`${origin}/import`, {
          multipart: { file: { name: 'journal.m4a', mimeType: 'audio/mp4', buffer: Buffer.from('synthetic audio') } },
        })
        const { job } = await upload.json()
        await page.request.post(`${origin}/import/${job.id}/start`, {
          data: { kind: 'journal', when: '2031-03-16 08:00' },
        })
        await page.goto(`${origin}/import/${job.id}`)
        await page.getByRole('button', { name: 'Apply 1', exact: true }).waitFor()
        assert({
          given: 'the names review is still waiting',
          should: 'withhold journal-type selection',
          actual: await page.getByRole('region', { name: 'Journal types', exact: true }).count(),
          expected: 0,
        })
        await page.getByRole('button', { name: 'Apply 1', exact: true }).click()
        const types = page.getByRole('region', { name: 'Journal types', exact: true })
        await types.waitFor()
        assert({
          given: 'corrected speech has been read',
          should: 'offer checked detected types',
          actual: [
            await types.getByRole('checkbox', { name: 'Health', exact: true }).isChecked(),
            await types.getByRole('checkbox', { name: 'Gratitude', exact: true }).isChecked(),
          ],
          expected: [true, true],
        })
        await types.getByRole('checkbox', { name: 'Health', exact: true }).uncheck()
        await types.getByText('Other journal types', { exact: true }).click()
        await types.getByRole('checkbox', { name: 'Leadership', exact: true }).check()
        await page.screenshot({ path: '/tmp/sky-journal-types-desktop.png', fullPage: true })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByRole('button', { name: 'Navigation', exact: true }).waitFor()
        await page.waitForFunction(() => (document.querySelector('.sky-side')?.getBoundingClientRect().right ?? 0) <= 0)
        assert({
          given: 'a phone-sized type checklist',
          should: 'fit without horizontal overflow',
          actual: await page.evaluate(() =>
            ['.sky-app', '.sky-main', '.sky-col', '.sky-journal-types'].map((selector) => {
              const box = document.querySelector(selector)!.getBoundingClientRect()
              return [selector, Math.round(box.width), Math.round(box.right)]
            }),
          ),
          expected: [
            ['.sky-app', 390, 390],
            ['.sky-main', 390, 390],
            ['.sky-col', 390, 390],
            ['.sky-journal-types', 362, 376],
          ],
        })
        await page.screenshot({ path: '/tmp/sky-journal-types-review.png', fullPage: true })
        const opened = page
          .context()
          .waitForEvent('page', { predicate: () => page.context().pages().length === FILES.length + 1 })
        await types.getByRole('button', { name: 'Create journals', exact: true }).click()
        await opened
        await page.locator('.sky-journal-results a').first().waitFor()
        await page.waitForFunction(
          () =>
            sessionStorage.getItem(
              Object.keys(sessionStorage).find((key) => key.startsWith('sky:journal-import:')) ?? '',
            ) === 'opened',
        )
        const tabs = page
          .context()
          .pages()
          .filter((candidate) => candidate !== page)
        await Promise.all(tabs.map((tab) => tab.waitForURL('**/explorer/**')))
        assert({
          given: 'the accepted type checklist',
          should: 'submit the selected types and open each result in its own Explorer tab',
          actual: [replies, chosen, tabs.map((tab) => new URL(tab.url()).pathname).sort()],
          expected: [['names', 'types'], ['Gratitude', 'Leadership'], FILES.map((file) => `/explorer/${file}`).sort()],
        })
        await page.reload()
        await page.locator('.sky-journal-results a').first().waitFor()
        assert({
          given: 'reopening a completed import',
          should: 'keep every link without opening duplicate tabs',
          actual: [page.context().pages().length, await page.locator('.sky-journal-results a').count(), errors],
          expected: [3, 2, []],
        })
      },
    )
  },
)
