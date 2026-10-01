import type { Page } from 'playwright'
import type { PromptEvent } from '#commands/lib/core/runCommand.ts'
import type { PromptRequest } from '#commands/lib/prompt/Prompter.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import { openJournals } from './import/openJournals.ts'
import { readAudio, readVideo } from './import/readback.ts'

const FILES = [
  'time/2031/W11/03-16/journal/Health_Feeling-Rested-After-A-Long-Walk.md',
  'time/2031/W11/03-16/journal/Gratitude_Grateful-For-Help-With-Atlas-Today.md',
]
const JOURNAL =
  '---\ntags: Journal/Health\nsummary: Feeling Rested After A Long Walk\n---\n\n# Health\n\nThe walk helped me feel rested.\n'

/** Deliver OS-opened URLs to the isolated test browser, keeping the owner's browser out of tests. */
function journalTabOpener() {
  const requests: string[][] = []
  let launch = async (_files: string[]): Promise<void> => {
    throw new Error('The test browser is not connected.')
  }
  return {
    requests,
    open: (files: string[]) => launch(files),
    connect: (page: Page, origin: string) => {
      launch = async (files) => {
        requests.push(files)
        await openJournals(files, Number(new URL(origin).port), async (_command, urls = []) => {
          for (const url of urls) {
            const tab = await page.context().newPage()
            await tab.goto(url)
          }
          return { success: true, code: 0, stdout: '', stderr: '' }
        })
      }
    },
  }
}

for (const source of ['audio', 'video'] as const)
  test(
    {
      name: `${source} journal import reviews names before types and opens separate browser tabs once`,
      timeout: 60000,
    },
    async (t) => {
      const native = journalTabOpener()
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
          files: {
            [FILES[1]]: JOURNAL.replaceAll('Health', 'Gratitude').replace(
              'Feeling Rested After A Long Walk',
              'Grateful For Help With Atlas Today',
            ),
          },
          day: true,
          imports: {
            openJournals: native.open,
            read: async ({ size }) => (source === 'video' ? readVideo(90) : readAudio(size, 90)),
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
          native.connect(page, origin)
          const upload = await page.request.post(`${origin}/import`, {
            multipart: {
              file: {
                name: source === 'video' ? 'journal.mov' : 'journal.m4a',
                mimeType: source === 'video' ? 'video/quicktime' : 'audio/mp4',
                buffer: Buffer.from('synthetic recording'),
              },
            },
          })
          const { job } = await upload.json()
          await page.request.post(`${origin}/import/${job.id}/start`, {
            data: { kind: 'journal', when: '2031-03-16 08:00' },
          })
          await page.goto(`${origin}/import/${job.id}`)
          await page.getByRole('button', { name: 'Apply 1', exact: true }).waitFor()
          assert({
            given: 'an import opened directly',
            should: 'identify the recording in the browser title',
            actual: await page.title(),
            expected: `sky · ${job.title}`,
          })
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
          await page.waitForFunction(
            () => (document.querySelector('.sky-side')?.getBoundingClientRect().right ?? 0) <= 0,
          )
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
          const opening = page.waitForResponse((response) => response.url().endsWith(`/import/${job.id}/open`))
          await types.getByRole('button', { name: 'Create journals', exact: true }).click()
          const response = await opening
          assert({
            given: 'the completed journal import',
            should: 'successfully ask the OS opener for every saved journal',
            actual: [response.status(), await response.json()],
            expected: [200, { opened: true, files: FILES }],
          })
          await page.locator('.sky-journal-results a').first().waitFor()
          await page.waitForFunction(
            () =>
              sessionStorage.getItem(
                Object.keys(sessionStorage).find((key) => key.startsWith('sky:journal-import:')) ?? '',
              ) === 'opened',
          )
          const explorer = page
            .context()
            .pages()
            .find((tab) => tab !== page)!
          await explorer.waitForURL('**/explorer/**')
          const journals = page
            .context()
            .pages()
            .filter((tab) => tab !== page)
          assert({
            given: 'the accepted type checklist',
            should: 'submit the selected types and open each result in its own browser tab through the OS',
            actual: [
              replies,
              chosen,
              journals.map((tab) => new URL(tab.url()).pathname),
              journals.map((tab) => new URL(tab.url()).search),
              native.requests,
            ],
            expected: [
              ['names', 'types'],
              ['Gratitude', 'Leadership'],
              FILES.map((file) => `/explorer/${file}`),
              ['', ''],
              [FILES],
            ],
          })
          await explorer.waitForFunction(() => document.title === 'sky · Feeling Rested After A Long Walk')
          await journals[1].waitForFunction(() => document.title === 'sky · Grateful For Help With Atlas Today')
          await explorer.goto(`${origin}/explorer/${FILES[1]}`)
          await explorer.waitForFunction(() => document.title === 'sky · Grateful For Help With Atlas Today')
          await explorer.reload()
          await explorer.waitForFunction(() => document.title === 'sky · Grateful For Help With Atlas Today')
          assert({
            given: 'the second journal opened and the page refreshed',
            should: 'keep the selected document and its browser title',
            actual: [await explorer.title(), new URL(explorer.url()).pathname],
            expected: ['sky · Grateful For Help With Atlas Today', `/explorer/${FILES[1]}`],
          })
          await explorer.goBack()
          await explorer.waitForFunction(() => document.title === 'sky · Feeling Rested After A Long Walk')
          await explorer.goForward()
          await explorer.waitForFunction(() => document.title === 'sky · Grateful For Help With Atlas Today')
          await page.reload()
          await page.locator('.sky-journal-results a').first().waitFor()
          assert({
            given: 'reopening a completed import',
            should: 'keep every link without opening duplicate tabs',
            actual: [
              page.context().pages().length,
              await page.locator('.sky-journal-results a').count(),
              native.requests,
              errors,
            ],
            expected: [3, 2, [FILES], []],
          })
        },
      )
    },
  )

test(
  {
    name: 'Open journals opens one browser tab per saved entry through the OS with popup blocking enabled',
    timeout: 60000,
  },
  async (t) => {
    const native = journalTabOpener()
    await runWysiwygE2e(
      t,
      {
        tempPrefix: 'sky-journal-popup-',
        file: FILES[0],
        initialMarkdown: JOURNAL,
        files: {
          [FILES[1]]: JOURNAL.replaceAll('Health', 'Gratitude').replace(
            'Feeling Rested After A Long Walk',
            'Grateful For Help With Atlas Today',
          ),
        },
        day: true,
        popupBlocking: true,
        now: new ZonedDateTime('2031-03-16 09:00', 'UTC'),
        imports: {
          openJournals: native.open,
          read: async () => readVideo(90),
          run: async function* () {
            return { ok: true, file: FILES[0], files: FILES }
          },
        },
      },
      async ({ page, origin, errors }) => {
        native.connect(page, origin)
        await page.addInitScript(() => {
          window.open = () => {
            throw new Error('Journal tabs must use the OS opener.')
          }
        })
        await page.route('**/day/*/schedule', (route) =>
          route.fulfill({ json: { read: false, errors: [], meetings: [] } }),
        )
        await page.goto(origin)
        await page.waitForSelector('.sky-day .sky-col')
        const choosing = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Add a file', exact: true }).click()
        const picker = await choosing
        await picker.setFiles({
          name: 'journal.mov',
          mimeType: 'video/quicktime',
          buffer: Buffer.from('synthetic video'),
        })
        await page.getByText('New journal from a video recording', { exact: true }).waitFor({ timeout: 5000 })
        await page.getByRole('button', { name: 'Start', exact: true }).click()
        await page.getByRole('button', { name: 'Open journals', exact: true }).waitFor()
        await page.waitForFunction(
          () =>
            sessionStorage.getItem(
              Object.keys(sessionStorage).find((key) => key.startsWith('sky:journal-import:')) ?? '',
            ) === 'opened',
        )
        const automatic = page
          .context()
          .pages()
          .filter((tab) => tab !== page)
        const opening = page.waitForResponse((response) => /\/import\/[^/]+\/open$/.test(response.url()))
        await page.getByRole('button', { name: 'Open journals', exact: true }).click()
        const response = await opening
        assert({
          given: 'an explicit Open journals click',
          should: 'successfully open the complete stored set',
          actual: [response.status(), await response.json()],
          expected: [200, { opened: true, files: FILES }],
        })
        await page.waitForFunction(
          () => !document.querySelector<HTMLButtonElement>('.sky-tabs button:last-child')?.disabled,
        )
        const journals = page
          .context()
          .pages()
          .filter((tab) => tab !== page && !automatic.includes(tab))
        const explorer = journals[0]
        await explorer.waitForFunction(() => document.title === 'sky · Feeling Rested After A Long Walk')
        await journals[1].waitForFunction(() => document.title === 'sky · Grateful For Help With Atlas Today')
        assert({
          given: 'a video journal imported through the picker with popup restrictions enabled',
          should: 'open separate tabs automatically and reopen every journal from one Open journals click',
          actual: [automatic.length, journals.map((tab) => new URL(tab.url()).pathname), native.requests, errors],
          expected: [2, FILES.map((file) => `/explorer/${file}`), [FILES, FILES], []],
        })
        await explorer.screenshot({ path: '/tmp/sky-journals-open-desktop.png', fullPage: true })
        await explorer.setViewportSize({ width: 390, height: 844 })
        await explorer.getByRole('button', { name: 'Navigation', exact: true }).waitFor()
        await explorer.waitForFunction(
          () => (document.querySelector('.sky-side')?.getBoundingClientRect().right ?? 0) <= 0,
        )
        assert({
          given: 'a journal opened on a phone-sized screen',
          should: 'keep the document within the viewport',
          actual: await explorer
            .locator('.sky-doc-column')
            .evaluate(
              (element) =>
                Math.round(element.getBoundingClientRect().right) <= window.innerWidth &&
                element.scrollWidth <= element.clientWidth,
            ),
          expected: true,
        })
        await explorer.screenshot({ path: '/tmp/sky-journals-open-mobile.png', fullPage: true })
      },
    )
  },
)
