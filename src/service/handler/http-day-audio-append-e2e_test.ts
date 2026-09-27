import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import {
  type AudioAppendUndo,
  appendAudioConversation,
  undoAudioAppend,
} from '#commands/all/message/_lib/savedAudioConversation.ts'
import { hash } from '#lib/outbox/files.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { CAF_TEST_HEADER } from '../../test/audioFixtures.ts'
import { dispatchFileDrop, runWysiwygE2e } from './httpWysiwygE2eTestHelpers.ts'
import { readIMessageAudio } from './import/readback.ts'
import { type StartArgs, startArgs } from './import/startArgs.ts'

const DAY = new PlainDate('2026-01-27')
const DAY_DOC = path.posix.join('time', dayFile(DAY))
const CONVERSATION = path.posix.join(path.posix.dirname(DAY_DOC), 'actions/messages/09-30_iMessage-Audio_Atlas.md')
const ORIGINAL =
  '---\nfrom: Jane Doe\nto: Me\nwhen: 2026-01-27 09:30\nmedium: iMessage Audio\nsummary: Atlas plan\n---\n\n**Jane Doe:**\n\nCan we review the Atlas plan?\n'
const clip = (name: string, text: string) => ({ name, text: CAF_TEST_HEADER + text, type: 'audio/mp4' })

test(
  {
    name: 'CAF imports choose new or existing conversations and direct drops append safely on desktop and phone',
    timeout: 90000,
  },
  async (t) => {
    const starts: StartArgs[] = []
    let notebook = ''
    const receipts = new Map<string, AudioAppendUndo>()
    const paths = () => ({ DIR_BASE: notebook, DIR_TIME: path.join(notebook, 'time') })
    await runWysiwygE2e(
      t,
      {
        initialMarkdown:
          '---\ncreated: 2026-01-27 07:00\n---\n\n# Day\n\n## Personal Complete\n\n09:30 > Jane Doe iMessage Audio -> [Atlas plan](actions/messages/09-30_iMessage-Audio_Atlas.md)\n',
        tempPrefix: 'sky-audio-append-e2e-',
        file: DAY_DOC,
        files: { [CONVERSATION]: ORIGINAL },
        day: true,
        store: true,
        now: new ZonedDateTime('2026-01-28 10:00', 'America/Chicago'),
        imports: {
          read: async ({ size }) => readIMessageAudio(size, 30),
          suggestWhen: () => '2026-01-28 09:45',
          opening: async (file) => (await readFile(file, 'utf8')).slice(CAF_TEST_HEADER.length),
          run: async function* (job, files) {
            const start = startArgs({ ...job, source: job.readback.source }, job.fields!, files)
            starts.push(start)
            const additions = await Promise.all(
              files.map(async (file) => {
                const words = (await readFile(file, 'utf8')).slice(CAF_TEST_HEADER.length)
                const speaker = job.fields!.audioSpeakers![path.basename(file)]
                return { hash: hash(words), speaker, body: `**${speaker}:**\n\n${words}` }
              }),
            )
            const result = await appendAudioConversation(paths(), job.fields!.appendTo!, additions)
            job.audioAdded = result.added
            job.canUndo = Boolean(result.undo)
            if (result.undo) receipts.set(job.id, result.undo)
            yield { type: 'line', text: 'Audio added.', level: 'log', command: 'message:append', depth: 1 }
            return { ok: true, file: CONVERSATION }
          },
          undoAudio: (job) => undoAudioAppend(paths(), job.fields!.appendTo!, receipts.get(job.id)!),
        },
      },
      async ({ page, origin, file, errors }) => {
        notebook = path.resolve(file.slice(0, -DAY_DOC.length))
        await page.route('**/day/*/schedule', (route) =>
          route.fulfill({ json: { read: false, errors: [], meetings: [] } }),
        )
        await page.setViewportSize({ width: 1400, height: 1000 })
        await page.goto(`${origin}/${DAY}`)
        await page.waitForSelector('.sky-day .sky-col')
        await dispatchFileDrop(page, '.sky-day .sky-col', [clip('reply.m4a', 'Yes, on Friday.')])
        const dialog = page.locator('.sky-confirm')
        await dialog.getByText('New iMessage Audio conversation', { exact: true }).waitFor()
        const destination = dialog.getByRole('combobox', { name: 'Conversation destination', exact: true })
        await destination.waitFor()
        assert({
          given: 'a CAF dropped on a past day with a saved conversation',
          should: 'default to creating on the viewed day and offer an existing destination',
          actual: [
            await destination.inputValue(),
            await dialog.getByRole('textbox', { name: 'When', exact: true }).inputValue(),
          ],
          expected: ['Create a new conversation', '2026-01-27 09:45'],
        })
        await destination.click()
        await page.getByRole('option', { name: 'Add to 09:30 · Jane Doe, Me — Atlas plan', exact: true }).click()
        await dialog.getByText('Add audio to conversation', { exact: true }).waitFor()
        const speaker = dialog.getByRole('combobox', { name: "Who's speaking in reply.m4a?", exact: true })
        await speaker.click()
        await page.getByRole('option', { name: 'Me', exact: true }).click()
        assert({
          given: 'an existing destination',
          should: 'offer its participants and inherit recipient and time',
          actual: [
            await speaker.inputValue(),
            await dialog.getByRole('combobox', { name: 'Who is it to?', exact: true }).count(),
            await dialog.getByRole('textbox', { name: 'When', exact: true }).count(),
          ],
          expected: ['Me', 0, 0],
        })
        await page.screenshot({ path: '/tmp/sky-audio-append-desktop.png', fullPage: true })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.waitForSelector('.sky-confirm.sky-sheet')
        await dialog.locator('.sky-audio-context a').waitFor()
        assert({
          given: 'the same dialog resized to a phone',
          should: 'retain destination and speaker',
          actual: [(await destination.inputValue()).includes('Atlas plan'), await speaker.inputValue()],
          expected: [true, 'Me'],
        })
        await page.screenshot({ path: '/tmp/sky-audio-append-phone.png', fullPage: true })
        await dialog.getByRole('button', { name: 'Add to conversation', exact: true }).click()
        await page.waitForSelector('.sky-filed-doc')
        const first = await readFile(path.join(notebook, CONVERSATION), 'utf8')
        assert({
          given: 'an accepted addition',
          should: 'append one turn to the original conversation',
          actual: first.endsWith('**Me:**\n\nYes, on Friday.\n'),
          expected: true,
        })

        await page.setViewportSize({ width: 1400, height: 1000 })
        await page.goto(`${origin}/${DAY}`)
        await page.waitForSelector('.sky-day .sky-col')
        const show = page.getByRole('button', { name: 'Show', exact: true })
        if (await show.count()) await show.first().click()
        await page.locator('[data-conversation-drop]').first().waitFor()
        await page
          .locator('[data-conversation-drop]')
          .first()
          .evaluate((row) => {
            const dataTransfer = new DataTransfer()
            dataTransfer.items.add(new File(['More words'], 'more.caf', { type: 'audio/x-caf' }))
            row.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }))
            row.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }))
          })
        await page.getByText('Add to this conversation', { exact: true }).waitFor()
        assert({
          given: 'a drag over an existing audio row',
          should: 'highlight the row without showing the page drop overlay',
          actual: await page.locator('.sky-drop').count(),
          expected: 0,
        })
        await dispatchFileDrop(page, '[data-conversation-drop]', [
          clip('renamed.m4a', 'Yes, on Friday.'),
          clip('next.caf', 'Great, see you then.'),
        ])
        await dialog.getByText('Add audio to conversation', { exact: true }).waitFor()
        await dialog.getByRole('combobox', { name: "Who's speaking in renamed.m4a?", exact: true }).fill('Me')
        await dialog.getByRole('combobox', { name: "Who's speaking in next.caf?", exact: true }).fill('Jane Doe')
        await dialog.getByRole('combobox', { name: "Who's speaking in next.caf?", exact: true }).press('Escape')
        await dialog.getByRole('button', { name: 'Add to conversation', exact: true }).click()
        await page.waitForSelector('.sky-filed-doc')
        const extended = await readFile(path.join(notebook, CONVERSATION), 'utf8')
        assert({
          given: 'a direct drop with a repeated clip and a new clip',
          should: 'start one append and add only the new turn',
          actual: [
            starts.map((start) => [start.command, start.args.file]),
            extended.split('Yes, on Friday.').length - 1,
            extended.endsWith('Great, see you then.\n'),
          ],
          expected: [
            [
              ['message:append', CONVERSATION],
              ['message:append', CONVERSATION],
            ],
            1,
            true,
          ],
        })
        await page.getByRole('button', { name: 'Undo audio addition', exact: true }).click()
        await page.getByText(/audio addition undone/).waitFor()
        assert({
          given: 'Undo immediately after an addition',
          should: 'restore the previous conversation',
          actual: await readFile(path.join(notebook, CONVERSATION), 'utf8'),
          expected: first,
        })

        await page.goto(`${origin}/explorer/${CONVERSATION}`)
        const addAudio = page.getByRole('button', { name: 'Add audio…', exact: true })
        await addAudio.waitFor()
        const chooserPromise = page.waitForEvent('filechooser')
        await addAudio.click()
        await (
          await chooserPromise
        ).setFiles({
          name: 'picker.m4a',
          mimeType: 'audio/mp4',
          buffer: Buffer.from(CAF_TEST_HEADER + 'Another reply.'),
        })
        await dialog.getByText('Add audio to conversation', { exact: true }).waitFor()
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        await dispatchFileDrop(page, '.sky-scroll[data-conversation-drop]', [clip('document.m4a', 'Another reply.')])
        await dialog.getByText('Add audio to conversation', { exact: true }).waitFor()
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })

        await page.goto(`${origin}/2026-01-29`)
        await page.waitForSelector('.sky-day .sky-col')
        await dispatchFileDrop(page, '.sky-day .sky-col', [clip('new.caf', 'A new conversation.')])
        await dialog.getByText('New iMessage Audio conversation', { exact: true }).waitFor()
        await dialog.getByRole('combobox', { name: 'Who is it to?', exact: true }).waitFor()
        assert({
          given: 'an empty day after adding to an existing conversation',
          should: 'create a new conversation without retaining the old destination',
          actual: [
            await dialog.getByRole('combobox', { name: 'Conversation destination', exact: true }).count(),
            await dialog.getByRole('textbox', { name: 'When', exact: true }).inputValue(),
            errors,
          ],
          expected: [0, '2026-01-29 09:45', []],
        })
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      },
    )
  },
)
