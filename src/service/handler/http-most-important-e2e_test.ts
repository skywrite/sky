import { readFile, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import type { MIDraft, MIDraftInput, MISuggestion, MostImportantAI } from '#lib/mostImportant/types.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { env } from '#shared/sys/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { holding } from '../activity.ts'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const DAY = new PlainDate('2030-06-17')
const FILE = path.posix.join('time', dayFile(DAY))
const EMPTY = '---\nstarted: 08:00\nended:\n---\n\n# 2030-06-17\n\n## Notes\n\nA sample day.\n'
const choices: MISuggestion[] = [
  {
    summary: 'Send Atlas proposal for feedback',
    reason: 'Jane needs the pricing options before reviewing the proposal.',
  },
  { summary: 'Decide the Widget launch scope', reason: 'The team needs a clear boundary for the next release.' },
  { summary: 'Review the Team Survey results', reason: 'Choose a useful response to the recurring feedback.' },
  { summary: 'Share the Atlas research notes', reason: 'Give the team enough context to challenge the assumptions.' },
  { summary: 'Send the Widget handoff', reason: 'The support team is waiting for the documented changes.' },
]

const longDraft: MIDraft = {
  summary: 'Prepare the Atlas release handoff and send the review draft to Jane',
  dueBy: '',
  body: [
    'Prepare a handoff that gives the support team the context they need for the Atlas release. Bring the current product brief and the open support questions into one document, then send the draft to Jane for review.',
    '## Why this matters',
    'The product brief explains what is changing, but the support team still needs a clear account of what customers will notice. A shared draft gives both teams something specific to review before launch. It also puts the remaining questions in one place so they can be resolved without another round of scattered messages.',
    'The handoff should preserve the distinctions already established in the brief: features that are ready, changes still under review, and issues that need a follow-up. The purpose is to give the team an accurate starting point for the release, with enough context to recognize where they need more information.',
    '## Done when',
    'Jane has the draft, with the agreed release scope and unresolved support questions clearly described. Include links to the product brief and the current issue list so the team can find the supporting detail. Keep the document focused on the handoff rather than reproducing every discussion that led to it.',
    'The review draft is ready to share with the support team.',
  ].join('\n\n'),
}

test({ name: 'a long draft review keeps document text clear of its controls', timeout: 60000 }, async (t) => {
  await runWysiwygE2e(
    t,
    {
      initialMarkdown: EMPTY,
      tempPrefix: 'sky-mi-review-',
      file: FILE,
      day: true,
      files: { [path.posix.join('time', dayFile(PlainDate.today()))]: '---\nstarted: 08:00\ntz: UTC\n---\n' },
    },
    async ({ page, origin, errors }) => {
      await page.addInitScript(
        ({ day, draft }) =>
          sessionStorage.setItem(`sky-mi-draft:${day}`, JSON.stringify({ step: 'review', answers: [], draft })),
        { day: DAY.ymd, draft: longDraft },
      )
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(`${origin}/${DAY.ymd}`)
      await page.getByRole('button', { name: 'Continue draft', exact: true }).click()
      const dialog = page.getByRole('dialog')
      const editor = dialog.getByRole('textbox', { name: 'Task document', exact: true })
      await editor.getByText('The review draft is ready to share with the support team.', { exact: true }).waitFor()
      const screenshots = env.get('SKY_MI_SCREENSHOTS')
      const title = dialog.getByRole('textbox', { name: 'Most important', exact: true })
      const scroller = dialog.locator('.sky-mi-scroll')
      const feedback = dialog.getByRole('textbox', { name: 'Refine with Sky', exact: true })
      try {
        for (const viewport of [
          { width: 1280, height: 800 },
          { width: 1024, height: 600 },
          { width: 390, height: 844 },
        ]) {
          await page.setViewportSize(viewport)
          await page.locator(viewport.width <= 900 ? '.mantine-Drawer-content' : '.mantine-Modal-content').waitFor()
          await editor.waitFor()
          await dialog.evaluate((element) =>
            Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
          )
          await scroller.evaluate((element) => {
            element.scrollTop = 0
          })
          if (screenshots)
            await page.screenshot({
              path: path.join(screenshots, `review-${viewport.width}.png`),
              animations: 'disabled',
            })
          assert({
            given: `a long review at ${viewport.width} × ${viewport.height}`,
            should: 'wrap the title, grow the document, and keep the footer below a single scroller',
            actual: {
              overlaps: await editor.evaluate((element) => {
                const last = element.lastElementChild!.getBoundingClientRect()
                return last.bottom > document.querySelector('.sky-mi-refinement')!.getBoundingClientRect().top
              }),
              titleClipped: await title.evaluate((element) => element.scrollHeight > element.clientHeight + 1),
              footerVisible: await dialog.locator('.sky-mi-footer').evaluate((element) => {
                const footer = element.getBoundingClientRect()
                const scroll = document.querySelector('.sky-mi-scroll')!.getBoundingClientRect()
                return scroll.bottom <= footer.top + 1 && footer.bottom <= innerHeight
              }),
              feedbackVisible: await feedback.isVisible(),
              overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            },
            expected: {
              overlaps: false,
              titleClipped: false,
              footerVisible: true,
              feedbackVisible: false,
              overflow: false,
            },
          })
          await editor.locator(':scope > :last-child').scrollIntoViewIfNeeded()
          assert({
            given: 'scrolling to the end of the draft',
            should: 'make the final paragraph readable above the action bar',
            actual: await editor.locator(':scope > :last-child').evaluate((element) => {
              const paragraph = element.getBoundingClientRect()
              const scroll = document.querySelector('.sky-mi-scroll')!.getBoundingClientRect()
              return paragraph.top >= scroll.top && paragraph.bottom <= scroll.bottom + 1
            }),
            expected: true,
          })
        }
        await dialog.getByRole('button', { name: 'Refine with Sky', exact: true }).click()
        await feedback.fill('Keep the handoff focused on the release scope.')
        await feedback.scrollIntoViewIfNeeded()
        if (screenshots)
          await page.screenshot({ path: path.join(screenshots, 'review-mobile-refine.png'), animations: 'disabled' })
        assert({
          given: 'refinement opened beneath a long draft on a phone',
          should: 'keep its input below the document',
          actual: await feedback.evaluate((element) => {
            const paragraph = document.querySelector('.sky-mi-document')!.lastElementChild!.getBoundingClientRect()
            return element.getBoundingClientRect().top >= paragraph.bottom
          }),
          expected: true,
        })
        await dialog.getByRole('button', { name: 'Add a deadline', exact: true }).click()
        const deadline = dialog.getByRole('textbox', { name: 'Due by (optional)', exact: true })
        await deadline.fill('Friday')
        await title.fill('Prepare the Atlas release handoff\nand send it to Jane')
        assert({
          given: 'an optional deadline and a title pasted with a line break',
          should: 'keep the title valid for saving and preserve the draft body',
          actual: {
            title: await title.inputValue(),
            deadline: await deadline.inputValue(),
            finalParagraph: await editor.getByText('The review draft is ready to share with the support team.').count(),
          },
          expected: {
            title: 'Prepare the Atlas release handoff and send it to Jane',
            deadline: 'Friday',
            finalParagraph: 1,
          },
        })
        assert({ given: 'the long review', should: 'render without browser errors', actual: errors, expected: [] })
      } finally {
        const released = page.waitForResponse(
          (response) => response.url().endsWith('/mi/activity') && response.request().postDataJSON().active === false,
        )
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await released
      }
    },
  )
})

test(
  {
    name: 'day MI creation offers more choices, asks relevant questions, refines an editable draft and saves once',
    timeout: 60000,
  },
  async (t) => {
    const drafts: MIDraftInput[] = []
    const contextReady = Promise.withResolvers<void>()
    const suggestionsReady = Promise.withResolvers<void>()
    let suggestionCalls = 0
    const ai: MostImportantAI = {
      suggest: async (_day, options, progress) => {
        suggestionCalls += 1
        if (suggestionCalls === 1) {
          progress?.({ stage: 'context' })
          await contextReady.promise
          progress?.({ stage: 'thinking', documents: 24 })
          await suggestionsReady.promise
          progress?.({ stage: 'writing' })
        }
        return {
          contextSummary: 'Several useful decisions are ready for your attention. '.repeat(15),
          suggestions: options?.previous?.length
            ? [{ summary: 'Review the Atlas launch risks', reason: 'Resolve the remaining uncertainty.' }]
            : choices,
        }
      },
      question: async (_day, input) =>
        input.answers.length ? null : 'Should Jane review the pricing options or receive a final recommendation?',
      draft: async (_day, input) => {
        drafts.push(input)
        return {
          summary: input.previous?.summary ?? 'Send Atlas pricing options for feedback',
          dueBy: '',
          body: input.previous
            ? input.previous.body + '\n## First move\n\nCompare the two pricing options against the brief.\n'
            : 'Jane will review the options before a final decision.\n\n## Why this matters\n\nAn early review will reveal which assumptions need checking.\n\n## Done when\n\n- The two options and trade-offs are sent to Jane.\n\n## Scope\n\nFeedback first; final approval follows later.\n',
        }
      },
    }
    await runWysiwygE2e(
      t,
      {
        initialMarkdown: EMPTY,
        tempPrefix: 'sky-mi-browser-',
        file: FILE,
        day: true,
        mostImportant: ai,
        // The calendar rail resolves its clock from a started day in this temporary notebook.
        files: { [path.posix.join('time', dayFile(PlainDate.today()))]: '---\nstarted: 08:00\ntz: UTC\n---\n' },
      },
      async ({ page, origin, file, errors }) => {
        page.on('response', (response) => {
          if (response.status() >= 500) errors.push(`http: ${response.status()} ${new URL(response.url()).pathname}`)
        })
        await page.setViewportSize({ width: 1280, height: 900 })
        await page.clock.install()
        await page.goto(`${origin}/${DAY.ymd}`)
        const invitation = page.getByRole('button', { name: "What's most important?", exact: true })
        await invitation.waitFor()
        assert({
          given: 'a day without a most important task',
          should: 'offer a single invitation in an open section',
          actual: {
            cards: await page.locator('.sky-day-priority').count(),
            copy: (await invitation.locator('xpath=..').innerText()).replace(/\s+/g, ' ').trim(),
          },
          expected: { cards: 0, copy: "＋ What's most important?" },
        })
        const screenshots = env.get('SKY_MI_SCREENSHOTS')
        if (screenshots) {
          await page.screenshot({ path: path.join(screenshots, 'day-empty.png'), animations: 'disabled' })
          await page.setViewportSize({ width: 390, height: 844 })
          await page.screenshot({ path: path.join(screenshots, 'day-mobile-empty.png'), animations: 'disabled' })
          await page.setViewportSize({ width: 1280, height: 900 })
        }
        await invitation.click()
        const dialog = page.getByRole('dialog')
        await dialog.getByText('Reading your recent days and plans…', { exact: true }).waitFor()
        contextReady.resolve()
        await dialog.getByText('24 notes and plans in context', { exact: true }).waitFor()
        const beforeCaption = await dialog.getByRole('status').locator('strong').innerText()
        await page.clock.fastForward(7500)
        assert({
          given: 'a slow model after the notebook context is ready',
          should: 'show animated placeholders, changing copy and real stages while writing your own stays available',
          actual: {
            skeletons: await dialog.locator('.sky-mi-skeleton').count(),
            changing: beforeCaption !== (await dialog.getByRole('status').locator('strong').innerText()),
            completed: await dialog.locator('.sky-mi-stages [data-state="done"]').count(),
            active: await dialog.locator('.sky-mi-stages [aria-current="step"]').innerText(),
            own: await dialog.getByRole('button', { name: 'Write your own', exact: true }).isEnabled(),
          },
          expected: { skeletons: 3, changing: true, completed: 1, active: '2\nChoose priorities', own: true },
        })
        if (screenshots)
          await page.screenshot({
            path: path.join(screenshots, 'mi-loading.png'),
            fullPage: true,
            animations: 'disabled',
          })
        await page.setViewportSize({ width: 390, height: 844 })
        await dialog.getByRole('button', { name: 'Write your own', exact: true }).waitFor()
        if (screenshots)
          await page.screenshot({
            path: path.join(screenshots, 'mi-mobile-loading.png'),
            fullPage: true,
            animations: 'disabled',
          })
        await page.setViewportSize({ width: 1280, height: 900 })
        suggestionsReady.resolve()
        await dialog.locator('.sky-mi-suggestion').first().waitFor()
        assert({
          given: 'the initial recommendations',
          should: 'show one recommended MI and two alternatives with a write-own option',
          actual: [
            await dialog.locator('.sky-mi-suggestion').count(),
            await dialog.getByText('Sky recommends', { exact: true }).count(),
            await dialog.getByRole('button', { name: 'Write your own', exact: true }).count(),
          ],
          expected: [3, 1, 1],
        })
        const footer = await dialog.locator('.sky-mi-footer').boundingBox()
        assert({
          given: 'a shortlist with a long background explanation',
          should: 'keep the explanation collapsed and all initial choices above visible controls',
          actual: {
            background: await dialog.locator('.sky-mi-background .sky-mi-context').isVisible(),
            choicesFit: await dialog
              .locator('.sky-mi-suggestion')
              .last()
              .evaluate((element) => element.getBoundingClientRect().bottom < innerHeight),
            footer: footer !== null && footer.y + footer.height <= 900,
            restartBlocked: holding().includes('creating a most important'),
          },
          expected: { background: false, choicesFit: true, footer: true, restartBlocked: true },
        })
        if (screenshots)
          await page.screenshot({
            path: path.join(screenshots, 'mi-suggestions.png'),
            fullPage: true,
            animations: 'disabled',
          })
        await page.setViewportSize({ width: 390, height: 844 })
        await dialog.locator('.sky-mi-suggestion').first().waitFor()
        if (screenshots)
          await page.screenshot({
            path: path.join(screenshots, 'mi-mobile-suggestions.png'),
            fullPage: true,
            animations: 'disabled',
          })
        const mobileFooter = await dialog.locator('.sky-mi-footer').boundingBox()
        assert({
          given: 'the same shortlist on a phone',
          should: 'keep write-your-own visible without horizontal scrolling',
          actual: {
            footer: mobileFooter !== null && mobileFooter.y + mobileFooter.height <= 844,
            overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          },
          expected: { footer: true, overflow: false },
        })
        await page.setViewportSize({ width: 1280, height: 900 })
        await dialog.getByRole('button', { name: 'More suggestions', exact: true }).click()
        assert({
          given: 'more suggestions requested',
          should: 'reveal the remaining choices without another model call',
          actual: [await dialog.locator('.sky-mi-suggestion').count(), suggestionCalls],
          expected: [5, 1],
        })
        await dialog.getByRole('button', { name: 'More suggestions', exact: true }).click()
        await dialog.getByRole('button', { name: /Review the Atlas launch risks/ }).waitFor()
        await dialog.getByRole('button', { name: /Send Atlas proposal for feedback/ }).click()
        const answer = dialog.getByRole('textbox', { name: 'Answer Sky', exact: true })
        await answer.fill('Only feedback on the two options.\nDo not turn this into a final decision.')
        await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
        const title = dialog.getByRole('textbox', { name: 'Most important', exact: true })
        await title.waitFor()
        await title.fill('Send Jane the Atlas options for review')
        const editor = dialog.getByRole('textbox', { name: 'Task document', exact: true })
        await editor.click()
        await page.keyboard.press('ControlOrMeta+End')
        await page.keyboard.press('Enter')
        await page.keyboard.type('Keep the optional support package out of this draft.')
        await dialog.getByRole('button', { name: 'Refine with Sky', exact: true }).click()
        await dialog.getByRole('textbox', { name: 'Refine with Sky', exact: true }).fill('Add a concrete first move.')
        await dialog.getByRole('button', { name: 'Refine draft', exact: true }).click()
        await editor.getByText('Compare the two pricing options against the brief.', { exact: true }).waitFor()
        const folder = path.join(path.dirname(file), 'most-important')
        assert({
          given: 'answers, a title edit, a document edit and a refinement',
          should: 'retain edits, improve the task and keep the notebook unsaved',
          actual: {
            title: await title.inputValue(),
            directEdit: drafts[1].previous?.body.includes('Keep the optional support package out of this draft.'),
            answers: drafts[1].answers.length,
            files: await readdir(folder).catch(() => []),
            scheduling: await dialog.getByRole('textbox', { name: /start time|duration|work slot/i }).count(),
          },
          expected: {
            title: 'Send Jane the Atlas options for review',
            directEdit: true,
            answers: 1,
            files: [],
            scheduling: 0,
          },
        })
        if (screenshots)
          await page.screenshot({
            path: path.join(screenshots, 'mi-review.png'),
            fullPage: true,
            animations: 'disabled',
          })
        await dialog.getByRole('button', { name: 'Keep for later', exact: true }).click()
        await page.reload()
        await page.getByRole('button', { name: 'Continue draft', exact: true }).waitFor()
        assert({
          given: 'an unfinished draft',
          should: 'keep the invitation open until the task is added to the day',
          actual: await page.locator('.sky-day-priority').count(),
          expected: 0,
        })
        await page.getByRole('button', { name: 'Continue draft', exact: true }).click()
        await dialog.getByRole('button', { name: 'Add to day', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        const row = page.locator('.sky-prow').filter({ hasText: 'Send Jane the Atlas options for review' })
        await row.waitFor()
        const card = page.locator('.sky-day-priority')
        assert({
          given: 'a most important task added to the day',
          should: 'show the task in a card with a quiet header action',
          actual: {
            task: await card.locator('.sky-prow').innerText(),
            add: await card.locator('.sky-block-head').getByRole('button', { name: 'Add another' }).count(),
            invitation: await invitation.count(),
          },
          expected: { task: 'Send Jane the Atlas options for review', add: 1, invitation: 0 },
        })
        if (screenshots)
          await page.screenshot({ path: path.join(screenshots, 'day-chosen.png'), animations: 'disabled' })
        const files = await readdir(folder)
        const saved = await readFile(path.join(folder, files[0]), 'utf8')
        assert({
          given: 'the draft resumed after reload and accepted',
          should: 'save exactly one untimed task with the final wording and no interview transcript',
          actual: {
            files: files.length,
            name: files[0].startsWith('MI1_'),
            headers: Object.keys(Document.fromMarkdown(saved).yaml),
            firstMove: saved.includes('## First move'),
            transcript: saved.includes('Do not turn this into a final decision.'),
            time: await row.locator('.sky-ptime').count(),
          },
          expected: {
            files: 1,
            name: true,
            headers: ['summary', 'complete', 'dateStarted', 'rel', 'tags'],
            firstMove: true,
            transcript: false,
            time: 0,
          },
        })
        await page.setViewportSize({ width: 390, height: 844 })
        if (screenshots)
          await page.screenshot({ path: path.join(screenshots, 'day-mobile-chosen.png'), animations: 'disabled' })
        await page.getByRole('button', { name: 'Add another', exact: true }).click()
        await dialog.getByRole('button', { name: 'Write your own', exact: true }).click()
        await dialog
          .getByRole('textbox', { name: 'Your most important task', exact: true })
          .fill('Review the Atlas assumptions')
        await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
        await dialog.getByRole('textbox', { name: 'Answer Sky', exact: true }).waitFor()
        await dialog.locator('button:not(:disabled)').filter({ hasText: 'Draft now' }).waitFor()
        if (screenshots)
          await page.screenshot({
            path: path.join(screenshots, 'mi-mobile.png'),
            fullPage: true,
            animations: 'disabled',
          })
        assert({
          given: 'writing an MI on a phone',
          should: 'start the same intelligent interview without overflow or browser errors',
          actual: { overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), errors },
          expected: { overflow: false, errors: [] },
        })
        const released = page.waitForResponse(
          (response) => response.url().endsWith('/mi/activity') && response.request().postDataJSON().active === false,
        )
        await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click()
        await released
        assert({
          given: 'the creation dialog is discarded after the questions',
          should: 'release its restart blocker',
          actual: holding().includes('creating a most important'),
          expected: false,
        })
      },
    )
  },
)
