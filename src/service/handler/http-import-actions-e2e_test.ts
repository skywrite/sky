// Run with `bun test service/handler/http-import-actions-e2e_test.ts` (a real browser and temporary notebook).
import { readFile, writeFile } from 'node:fs/promises'
import {
  actionItemWithSource,
  loadActionItemReview,
  saveActionItemReview,
} from '#commands/all/meeting/lib/actionItemReview.ts'
import type { PlaceAnswer, PlacePrompt } from '#commands/lib/prompt/Prompter.ts'
import type { DocumentIO } from '#shared/models/Person/write.ts'
import { assert, test } from '#test'
import { runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'

const FILE = 'time/2026/W05/01-27/actions/meetings/0930_Atlas-planning.md'
const NOTES = `---
summary: Atlas planning
who: Jane Doe, Alex Chen
when: 2026-01-27 09:30 - 10:00
---

# Meeting

## Summary

Keep the release small.

## Action Items (me)

- Draft the checklist
- Review the budget

## Action Items (others)

- Alex Chen: check the timeline
`
const WHEN = { date: '2026-01-28', time: null }

test(
  {
    name: 'import action review edits every item, adds tasks, and saves the source notes on desktop and phone',
    timeout: 60000,
  },
  async (t) => {
    let file = ''
    let routed: string[] = []
    let editable = true
    let received: PlaceAnswer | null = null
    const io: DocumentIO = {
      read: async () => ({ path: FILE, content: await readFile(file, 'utf8'), version: 1 }),
      save: async (_path, content) => {
        await writeFile(file, content)
        return { saved: true }
      },
    }
    await runWysiwygE2e(
      t,
      {
        file: FILE,
        initialMarkdown: NOTES,
        tempPrefix: 'sky-import-actions-',
        day: true,
        imports: {
          run: async function* () {
            const review = await loadActionItemReview(FILE, [], io)
            const prompt: PlacePrompt = {
              editable,
              source: review.source,
              message: 'Accept action items',
              items: review.items.map((item, index) => ({
                value: String(index),
                label: item.text,
                mine: item.mine,
                when: WHEN,
              })),
              initial: ['0'],
              today: '2026-01-27',
              createdThrough: '2026-02-01',
              fallback: WHEN,
              waiting: 0,
            }
            let reply!: (value: unknown) => void
            const answered = new Promise<PlaceAnswer | null>((resolve) => {
              reply = (value) => resolve(value as PlaceAnswer | null)
            })
            yield {
              type: 'stage',
              id: 'actions',
              label: 'Action items',
              detail: null,
              command: 'meeting:new',
              depth: 1,
            }
            yield { type: 'prompt', id: 'actions', request: { kind: 'place', prompt }, reply }
            const answer = await answered
            received = answer
            if (answer === null) return { ok: false, message: 'Cancelled' }
            const result = await saveActionItemReview(review, answer, io)
            routed = result.accepted.map((item) => actionItemWithSource(item.text, review.source))
            return { ok: true, file: FILE }
          },
        },
      },
      async ({ page, origin, file: fixture, errors }) => {
        file = fixture
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const start = async () => {
          const upload = await page.request.post(`${origin}/import`, {
            multipart: {
              file: {
                name: 'recap.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('Jane Doe: Let us review the Atlas launch.'),
              },
            },
          })
          const { job } = await upload.json()
          await page.request.post(`${origin}/import/${job.id}/start`, {
            data: {
              kind: 'meeting',
              when: '2026-01-27 09:30',
              category: 'Professional',
              fresh: false,
            },
          })
          await page.goto(`${origin}/import/${job.id}`)
          if (editable) await page.getByRole('button', { name: '+ Add action item', exact: true }).waitFor()
          else await page.getByRole('button', { name: 'Accept 1', exact: true }).waitFor()
        }
        await page.setViewportSize({ width: 1440, height: 1100 })
        await start()
        const source = page.locator('.sky-action-source')
        assert({
          given: 'the action review for a memo',
          should: 'show its actual meeting title, date, attendees and notes link',
          actual: [await source.textContent(), await source.getByRole('link').getAttribute('href')],
          expected: [
            'From the meetingAtlas planning ↗2026-01-27 09:30 - 10:00 · Jane Doe, Alex Chen',
            `/explorer/${FILE}`,
          ],
        })
        await page
          .getByRole('textbox', { name: 'Action item 1', exact: true })
          .fill('Draft the Atlas release checklist')
        await page.getByRole('textbox', { name: 'Action item 2', exact: true }).fill('Review the revised Atlas budget')
        await page
          .getByRole('textbox', { name: 'Action item 3', exact: true })
          .fill('Alex Chen: confirm the release timeline')
        await page.getByRole('button', { name: '+ Add action item', exact: true }).click()
        await page
          .getByRole('textbox', { name: 'Action item 4', exact: true })
          .fill('Send the launch checklist to the team')
        await page.getByRole('button', { name: '+ Add action item', exact: true }).click()
        await page.getByRole('textbox', { name: 'Action item 5', exact: true }).fill('Discuss support coverage')
        await page.getByRole('checkbox', { name: 'Accept action item 5', exact: true }).click()
        await page.getByRole('button', { name: '+ Add action item', exact: true }).click()
        await page.getByRole('button', { name: 'Remove new action item 6', exact: true }).click()
        const accepted = page.getByRole('button', { name: 'Accept 2', exact: true })
        await accepted.waitFor()
        await page.screenshot({ path: '/tmp/sky-import-actions-desktop.png', fullPage: true })
        await page.setViewportSize({ width: 390, height: 844 })
        await page
          .getByRole('textbox', { name: 'Action item 4', exact: true })
          .fill('Send the launch checklist and meeting recap to the team')
        assert({
          given: 'the same review narrowed to a phone while editing',
          should: 'keep all five descriptions editable and fit the viewport',
          actual: [
            await page.getByRole('textbox', { name: /^Action item \d+$/ }).count(),
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ],
          expected: [5, true],
        })
        await source.scrollIntoViewIfNeeded()
        await page.screenshot({ path: '/tmp/sky-import-actions-phone.png', fullPage: true })
        await accepted.scrollIntoViewIfNeeded()
        await accepted.click()
        await page.locator('.sky-placed').waitFor()
        assert({
          given: 'Accept after editing checked and unchecked rows and adding two items',
          should: 'persist every edit, route only checked tasks with their source, and show the edited placements',
          actual: [
            await readFile(file, 'utf8'),
            routed.map((text) => text.split(' — ')[0]),
            await page.locator('.sky-placed-item').allTextContents(),
          ],
          expected: [
            NOTES.replace('Draft the checklist', 'Draft the Atlas release checklist')
              .replace(
                'Review the budget',
                'Review the revised Atlas budget\n- Send the launch checklist and meeting recap to the team\n- Discuss support coverage',
              )
              .replace('Alex Chen: check the timeline', 'Alex Chen: confirm the release timeline'),
            ['Draft the Atlas release checklist', 'Send the launch checklist and meeting recap to the team'],
            ['Draft the Atlas release checklist', 'Send the launch checklist and meeting recap to the team'],
          ],
        })
        assert({
          given: 'the resulting tasks',
          should: 'retain their meeting link',
          actual: routed.every((text) => text.includes(`[Atlas planning · 2026-01-27](/${FILE})`)),
          expected: true,
        })

        await writeFile(file, NOTES.split('## Action Items')[0])
        await start()
        await page.getByText('No action items were found. Add anything you want to follow up on.').waitFor()
        await page.getByRole('button', { name: '+ Add action item', exact: true }).click()
        await page.getByRole('textbox', { name: 'Action item 1', exact: true }).fill('Check the revised launch date')
        await page.getByRole('button', { name: 'Save without adding tasks', exact: true }).click()
        await page.getByText('No tasks added.', { exact: true }).waitFor()
        assert({
          given: 'an empty summary and a new item saved without adding tasks',
          should: 'save its new notes section with no routed tasks or browser errors',
          actual: [
            (await readFile(file, 'utf8')).includes('## Action Items (me)\n\n- Check the revised launch date'),
            routed,
            errors,
          ],
          expected: [true, [], []],
        })
        editable = false
        await writeFile(file, NOTES)
        await start()
        await page.getByRole('button', { name: 'Accept 1', exact: true }).click()
        await page.locator('.sky-placed-item').waitFor()
        assert({
          given: 'a review already waiting on an older server without editing support',
          should: 'send only the checked item in the original format',
          actual: received,
          expected: [{ value: '0', when: WHEN }],
        })
      },
    )
  },
)
