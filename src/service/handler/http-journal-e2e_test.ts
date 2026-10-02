import { readFile, readdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { JournalAI, JournalView } from '#lib/journal/types.ts'
import JournalDocument from '#shared/models/Journal/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2025-03-18')
const QUESTION = 'What would change if the Atlas experiment were allowed to stay small?'
const FOLLOWUP = 'What did the walk make easier to see?'
let followedAnswers = ''
const ai: JournalAI = {
  enrich: async () => ({ tags: 'Health/Walking', rel: ['projects/Atlas'] }),
  name: async (topic) => ({
    journalType: topic.journalType ?? topic.title,
    summary: 'A Quiet Walk Changed My Perspective',
  }),
  prepare: async () => [
    {
      title: 'Perspective',
      journalType: 'Lessons Learned',
      question: QUESTION,
      observation: 'The plan leaves room for a small experiment.',
      sources: [
        { path: 'notes/Atlas.md', title: 'Atlas', quote: 'Try a small experiment.\n\nLearn before expanding.' },
      ],
    },
  ],
  followup: async (input) => {
    followedAnswers = JSON.stringify(input.answers)
    return { question: FOLLOWUP, covered: [] }
  },
}

test(
  {
    name: 'journal opens from the day, saves real Markdown, resumes and follows up without leaving the focused editor',
    timeout: 90000,
  },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '---\nstarted: 08:00\ntz: UTC\n---\n\n## Professional Todos\n\n- Plan the Atlas experiment\n',
        tempPrefix: 'sky-journal-browser-',
        file: `time/${dayFile(DAY)}`,
        files: { 'notes/Atlas.md': '# Atlas\n\nTry a small experiment.\n\nLearn before expanding.' },
        day: true,
        now: new ZonedDateTime('2025-03-18T18:30:00', 'UTC'),
        journal: { ai },
      },
      async ({ page, origin, file, errors }) => {
        page.on('dialog', (dialog) => void dialog.accept())
        await page.route('**/schedule', (route) => route.fulfill({ json: { read: true, errors: [], meetings: [] } }))
        const view = async () =>
          (await (await page.request.get(`${origin}/journal/_api/${DAY.ymd}`)).json()) as JournalView
        await page.setViewportSize({ width: 1500, height: 1100 })
        await page.goto(`${origin}/${DAY.ymd}`)
        await page.getByRole('link', { name: 'Journal', exact: true }).click()
        const writer = page.locator('.sky-journal .sky-wysiwyg[contenteditable]').first()
        await writer.waitFor()
        await page.waitForFunction(() => document.title.includes('Health · Journal'))
        const noFiles = await readdir(path.join(path.dirname(file), 'journal')).catch(() => [])
        assert({
          given: 'Start journaling on a day with no reflections',
          should: 'open Health without creating files',
          actual: { files: noFiles.length, explorer: new URL(page.url()).pathname.includes('explorer') },
          expected: { files: 0, explorer: false },
        })
        await writer.click()
        await page.keyboard.insertText('A quiet walk changed how I felt about Atlas.')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        await page.keyboard.insertText('I can leave the experiment small and learn.')
        await page.getByRole('button', { name: /Go deeper/ }).click()
        await page.getByRole('heading', { name: FOLLOWUP, exact: true }).waitFor()
        assert({
          given: 'writing followed immediately by Go deeper',
          should: 'use the flushed answer in a follow-up within the same reflection',
          actual: followedAnswers.includes('A quiet walk'),
          expected: true,
        })
        const snapshot = await view()
        const health = snapshot.session!.topics.find((topic) => topic.id === 'health')!
        const root = file.slice(0, file.lastIndexOf('/time/'))
        const healthFile = path.join(root, health.file!)
        assert({
          given: 'a saved Health answer',
          should: 'store readable Markdown and no empty Mood or optional files',
          actual: [
            (await readFile(healthFile, 'utf8')).includes('A quiet walk'),
            (await readFile(healthFile, 'utf8')).includes('<!--'),
            path.basename(healthFile),
            (await readdir(path.dirname(healthFile))).length,
          ],
          expected: [true, false, 'Health.md', 1],
        })
        await writer.click()
        await page.keyboard.press('End')
        await page.keyboard.insertText(' A small reset.')
        await page.getByRole('button', { name: `Dismiss question: ${health.questions[0].text}`, exact: true }).click()
        await page.getByRole('heading', { name: health.questions[0].text, exact: true }).waitFor({ state: 'hidden' })
        assert({
          given: 'a question dismissed immediately after typing',
          should: 'save the latest writing before hiding only that question',
          actual: [
            (await readFile(healthFile, 'utf8')).includes('A small reset.'),
            await page.getByRole('heading', { name: FOLLOWUP, exact: true }).count(),
          ],
          expected: [true, 1],
        })
        await page.locator('.sky-journal-dismissed-notice').getByRole('button', { name: 'Undo', exact: true }).click()
        await page.getByRole('heading', { name: health.questions[0].text, exact: true }).waitFor()
        await page.waitForFunction(() =>
          document.querySelector('.sky-wysiwyg')?.textContent?.includes('A small reset.'),
        )
        await page.getByRole('button', { name: `Dismiss question: ${FOLLOWUP}`, exact: true }).click()
        await page.getByRole('heading', { name: FOLLOWUP, exact: true }).waitFor({ state: 'hidden' })
        await page.reload()
        await page.getByRole('heading', { name: health.questions[0].text, exact: true }).waitFor()
        assert({
          given: 'a dismissed unanswered follow-up after a reload',
          should: 'remain dismissed without creating an empty answer in the file',
          actual: [
            await page.getByRole('heading', { name: FOLLOWUP, exact: true }).count(),
            (await readFile(healthFile, 'utf8')).includes(FOLLOWUP),
          ],
          expected: [0, false],
        })
        await page.locator('.sky-journal-dismissed > summary').click()
        await page.getByRole('button', { name: `Restore question: ${FOLLOWUP}`, exact: true }).click()
        await page.getByRole('heading', { name: FOLLOWUP, exact: true }).waitFor()
        const styles = await page.locator('.sky-journal-question-heading > :first-child').evaluateAll((headings) =>
          headings.map((heading) => {
            const style = getComputedStyle(heading)
            return [style.fontSize, style.fontWeight]
          }),
        )
        assert({
          given: 'a regular question and its follow-up',
          should: 'give both questions the same readable typography',
          actual: styles,
          expected: [
            ['24px', '500'],
            ['24px', '500'],
          ],
        })
        await page.screenshot({ path: '/tmp/sky-journal-desktop.png', fullPage: true })
        await page.getByRole('button', { name: 'Next: Mood →', exact: true }).click()
        await page.waitForFunction(() => document.title.includes('Mood · Journal'))
        await page.goBack()
        await page.waitForFunction(() => document.title.includes('A Quiet Walk Changed My Perspective · Journal'))
        const namedHealth = (await view()).session!.topics.find((item) => item.id === 'health')!
        const enriched = JournalDocument.fromMarkdown(await readFile(path.join(root, namedHealth.file!), 'utf8'))
        assert({
          given: 'finishing a reflection through Next',
          should: 'save its automatic tags and relationship links with the journal type',
          actual: { tags: [...enriched.tags], rel: [...enriched.rel] },
          expected: { tags: ['Journal/Health', 'Health/Walking'], rel: ['projects/Atlas'] },
        })
        assert({
          given: 'moving on after writing',
          should: 'name the journal by type and summary while keeping the focused route',
          actual: [path.basename(namedHealth.file!), new URL(page.url()).pathname],
          expected: ['Health_A-Quiet-Walk-Changed-My-Perspective.md', `/${DAY.ymd}/journal/health`],
        })
        await page.waitForFunction(() => document.querySelector('.sky-wysiwyg')?.textContent?.includes('A quiet walk'))
        await page.reload()
        await page.waitForFunction(() => document.querySelector('.sky-wysiwyg')?.textContent?.includes('A quiet walk'))
        // Unchanged polling must keep the same selected text nodes across paragraphs.
        const selected = await page.evaluate(() => {
          const paragraphs = document.querySelector('.sky-wysiwyg')!.querySelectorAll('p')
          const first = paragraphs[0],
            last = paragraphs[paragraphs.length - 1]
          const range = document.createRange()
          range.setStart(first.firstChild!, 0)
          range.setEndAfter(last)
          getSelection()?.removeAllRanges()
          getSelection()?.addRange(range)
          return getSelection()?.toString()
        })
        await page.waitForTimeout(5600)
        assert({
          given: 'a selection spanning paragraphs through session and file polling',
          should: 'keep the text selected',
          actual: await page.evaluate(() => getSelection()?.toString()),
          expected: selected,
        })
        await page.getByRole('button', { name: /Your reflections/ }).click()
        await page.getByRole('button', { name: /Perspective Ready/ }).click()
        await page.getByRole('heading', { name: QUESTION, exact: true }).waitFor()
        await page.getByRole('complementary', { name: 'Context', exact: true }).waitFor()
        await page.getByRole('button', { name: 'View sources', exact: true }).click()
        const quote = page.locator('.sky-journal-source blockquote')
        await quote.waitFor()
        assert({
          given: 'an observation with evidence',
          should: 'let the owner inspect its source without leaving the journal',
          actual: await quote.textContent(),
          expected: 'Try a small experiment.\n\nLearn before expanding.',
        })
        const bounds = await quote.boundingBox()
        if (!bounds) throw new Error('No source quote bounds')
        await page.mouse.move(bounds.x + 20, bounds.y + 12)
        await page.mouse.down()
        await page.mouse.move(bounds.x + 130, bounds.y + bounds.height - 12)
        const dragged = await page.evaluate(() => getSelection()?.toString())
        await page.waitForTimeout(3000)
        await page.mouse.up()
        assert({
          given: 'a source selection dragged across a background refresh',
          should: 'keep the selected text',
          actual: [Boolean(dragged), await page.evaluate(() => getSelection()?.toString())],
          expected: [true, dragged],
        })
        await page.keyboard.press('Escape')
        await page.getByRole('dialog').waitFor({ state: 'hidden' })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.waitForTimeout(350)
        await page.screenshot({ path: '/tmp/sky-journal-mobile.png', fullPage: true })
        assert({
          given: 'the focused session on a narrow screen',
          should: 'fit the viewport',
          actual: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          expected: true,
        })
        await page.getByRole('button', { name: 'Pass for now', exact: true }).click()
        await page.getByRole('link', { name: /Continue journaling/ }).waitFor()
        const savedLink = page.locator(`a[href="/${DAY.ymd}/journal/health"]`)
        assert({
          given: 'a saved reflection on the day',
          should: 'reopen inside Journal',
          actual: await savedLink.count(),
          expected: 1,
        })
        assert({
          given: 'the complete browser flow',
          should: 'have no client runtime errors',
          actual: errors.filter((error) => error.startsWith('pageerror:')),
          expected: [],
        })
      },
    )
  },
)

test(
  { name: 'journal drafts recover after a failed save and conflicting raw-file edits stay explicit', timeout: 90000 },
  async (t) => {
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: '---\nstarted: 08:00\ntz: UTC\n---\n',
        tempPrefix: 'sky-journal-recovery-',
        file: `time/${dayFile(DAY)}`,
        day: true,
        now: new ZonedDateTime('2025-03-18T18:30:00', 'UTC'),
        journal: { ai },
      },
      async ({ page, origin, file }) => {
        page.on('dialog', (dialog) => void dialog.accept())
        await page.route('**/schedule', (route) => route.fulfill({ json: { read: true, errors: [], meetings: [] } }))
        const answerApi = `${origin}/journal/_api/${DAY.ymd}/topics/health/answers/q1`
        await page.goto(`${origin}/${DAY.ymd}/journal`)
        await page.getByRole('button', { name: 'Start journaling', exact: true }).click()
        const writer = page.locator('.sky-journal .sky-wysiwyg[contenteditable]').first()
        await writer.waitFor()
        await page.route('**/answers/q1', (route) =>
          route.request().method() === 'PUT'
            ? route.fulfill({ status: 503, json: { message: 'Temporarily unavailable. Your draft stays here.' } })
            : route.continue(),
        )
        await writer.click()
        await page.keyboard.insertText('Recovered writing matters.')
        await page.getByRole('status').filter({ hasText: 'Not saved' }).waitFor()
        await page.reload()
        await page.waitForFunction(() =>
          document.querySelector('.sky-wysiwyg')?.textContent?.includes('Recovered writing matters.'),
        )
        await page.getByRole('status').filter({ hasText: 'Not saved' }).waitFor()
        await page.unroute('**/answers/q1')
        await page.getByRole('button', { name: 'Retry', exact: true }).click()
        await page.waitForFunction(async (url) => {
          const answer = await (await fetch(url)).json()
          return answer.content.includes('Recovered writing matters.')
        }, answerApi)
        const view = (await (await page.request.get(`${origin}/journal/_api/${DAY.ymd}`)).json()) as JournalView
        const root = file.slice(0, file.lastIndexOf('/time/'))
        const healthFile = path.join(root, view.session!.topics[0].file!)
        const saved = await readFile(healthFile, 'utf8')
        await writeFile(healthFile, saved.replace('Recovered writing matters.', 'A new external answer.'))
        await writer.click()
        await page.keyboard.press('End')
        await page.keyboard.insertText(' More local writing.')
        await page.getByRole('alert').filter({ hasText: 'changed elsewhere' }).waitFor()
        assert({
          given: 'a stale browser with a recovered draft and an external file edit',
          should: 'preserve the external answer until replacement is explicit',
          actual: (await readFile(healthFile, 'utf8')).includes('A new external answer.'),
          expected: true,
        })
        await page.getByRole('button', { name: 'Replace saved answer with mine', exact: true }).click()
        await page.waitForFunction(async (url) => {
          const answer = await (await fetch(url)).json()
          return answer.content.includes('More local writing.')
        }, answerApi)
        const replaced = await readFile(healthFile, 'utf8')
        await writeFile(healthFile, replaced.replace('More local writing.', 'A refreshed passage.'))
        await page.waitForFunction(() =>
          document.querySelector('.sky-wysiwyg')?.textContent?.includes('A refreshed passage.'),
        )
        assert({
          given: 'an unchanged editor after a subsequent file edit',
          should: 'refresh changed content and retain its screen title',
          actual: [
            (await page.title()).includes('Health · Journal'),
            await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('sky:writing:')).length),
          ],
          expected: [true, 0],
        })
      },
    )
  },
)
