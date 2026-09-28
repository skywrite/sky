import * as path from 'node:path'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { dispatchFileDrop, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import type { Listen } from './import/jobs.ts'
import { readAudio } from './import/readback.ts'
import { startArgs } from './import/startArgs.ts'

const DAY = new PlainDate('2025-03-15')
const DAY_DOC = path.posix.join('time', dayFile(DAY))
const CATEGORY = '.sky-choice-inline:has(.sky-choice-label:text-is("Category")) .sky-pill[data-on="true"]'

test({ name: 'voice memo category suggestions respect manual choices and retries', timeout: 60000 }, async (t) => {
  let heard!: (listen: Listen) => void
  const categories: unknown[] = []
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: '---\ncreated: 2025-03-15 07:00\n---\n\n# Day\n',
      tempPrefix: 'import-category-',
      file: DAY_DOC,
      day: true,
      imports: {
        read: async ({ size }) => readAudio(size, 60),
        listen: () =>
          new Promise((resolve) => {
            heard = resolve
          }),
        run: async function* (job, files) {
          if (!job.fields) throw new Error('Missing import fields')
          categories.push(startArgs({ ...job, source: job.readback.source }, job.fields, files).args.category)
          yield { type: 'line', text: 'Preparing the memo.', level: 'log', command: 'meeting:new', depth: 1 }
          return { ok: false, message: 'Scripted pause for retry.' }
        },
      },
    },
    async ({ page, origin, errors }) => {
      await page.route('**/day/*/schedule', (route) =>
        route.fulfill({ json: { read: true, errors: [], meetings: [] } }),
      )
      await page.setViewportSize({ width: 1400, height: 900 })
      const cases = [
        { suggestion: 'Personal', before: null, after: null, expected: 'Personal' },
        { suggestion: 'Personal', before: 'Professional', after: null, expected: 'Professional' },
        { suggestion: 'Professional', before: null, after: 'Personal', expected: 'Personal' },
        { suggestion: undefined, before: null, after: null, expected: 'Professional' },
      ] as const
      for (const [index, example] of cases.entries()) {
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.waitForSelector('.sky-day button[aria-label="Add a file"]:not([disabled])')
        await dispatchFileDrop(page, '.sky-day .sky-col', {
          name: `memo-${index}.m4a`,
          type: 'audio/mp4',
          text: 'mock recording',
        })
        await page.waitForSelector('.sky-confirm-title')
        // Kind and time edits must not count as a manual category choice.
        await page.getByRole('button', { name: 'Note', exact: true }).click()
        await page.locator('input[aria-label="When"]').fill(`${DAY.ymd} 09:00`)
        if (example.before) await page.getByRole('button', { name: example.before, exact: true }).click()
        heard({
          kind: 'meeting',
          opening: 'A recap of the weekend.',
          guess: 'Sounds like a meeting recap.',
          category: example.suggestion,
        })
        await page.waitForSelector('.sky-confirm-guess')
        if (example.after) await page.getByRole('button', { name: example.after, exact: true }).click()
        await page.waitForSelector(`${CATEGORY}:text-is("${example.expected}")`)
        assert({
          given: `category suggestion ${example.suggestion ?? 'unavailable'} with choices before and after it`,
          should: 'keep the edited kind and time, and apply only an untouched category suggestion',
          actual: [
            await page.textContent(CATEGORY),
            await page.locator('.sky-choice .sky-pill[data-on="true"]').textContent(),
            await page.inputValue('input[aria-label="When"]'),
          ],
          expected: [example.expected, 'Note', `${DAY.ymd} 09:00`],
        })
        await page.getByRole('button', { name: 'Start', exact: true }).click()
        await page.getByRole('button', { name: 'Start again', exact: true }).waitFor()
        await page.getByRole('button', { name: 'Start again', exact: true }).click()
        await page.waitForSelector('.sky-confirm-guess')
        assert({
          given: 'a retry that still carries the original automatic suggestion',
          should: 'keep the category submitted on the previous attempt',
          actual: await page.textContent(CATEGORY),
          expected: example.expected,
        })
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      }
      assert({
        given: 'all four imports started',
        should: 'pass the selected category to the door command without browser errors',
        actual: [categories, errors],
        expected: [cases.map(({ expected }) => `${expected} Complete`), []],
      })
    },
  )
})
